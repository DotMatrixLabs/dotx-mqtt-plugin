import * as mqtt from 'mqtt';
import { MQTTSettings, ConnectionState } from './types';

export interface PublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

type ConnectionCallback = (state: ConnectionState, error?: string) => void;
type MessageCallback = (topic: string, payload: string) => void;

/**
 * MQTT client wrapper: connection lifecycle, availability (LWT) and
 * per-topic rate limiting that always delivers the latest value.
 */
export class MQTTClient {
  private client: mqtt.MqttClient | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private settings: MQTTSettings;

  // Per-topic throttle state
  private lastPublishAt = new Map<string, number>();
  private pending = new Map<string, { payload: string; opts: PublishOptions }>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private onConnectionChangeCallback?: ConnectionCallback;
  private onMessageCallback?: MessageCallback;

  constructor(settings: MQTTSettings) {
    this.settings = settings;
  }

  updateSettings(settings: MQTTSettings) {
    this.settings = settings;
  }

  getState(): ConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === 'connected' && !!this.client?.connected;
  }

  /** Topic the client marks `online`/`offline` (retained, offline via LWT). */
  getAvailabilityTopic(): string {
    return `${this.settings.topicPrefix}/status`;
  }

  onConnectionChange(callback: ConnectionCallback) {
    this.onConnectionChangeCallback = callback;
  }

  onMessage(callback: MessageCallback) {
    this.onMessageCallback = callback;
  }

  /**
   * Starts connecting. Progress and failures are reported through
   * `onConnectionChange`; with auto-reconnect the client keeps retrying.
   */
  connect(): void {
    this.teardown();
    this.setConnectionState('connecting');

    const protocol = this.settings.useSsl ? 'mqtts' : 'mqtt';
    const brokerUrl = `${protocol}://${this.settings.brokerIP.trim()}:${this.settings.brokerPort}`;
    const availabilityTopic = this.getAvailabilityTopic();

    const options: mqtt.IClientOptions = {
      clientId: this.settings.clientId,
      keepalive: this.settings.keepalive,
      clean: this.settings.cleanSession,
      reconnectPeriod: this.settings.autoReconnect ? this.settings.reconnectInterval * 1000 : 0,
      connectTimeout: 10_000,
      will: { topic: availabilityTopic, payload: 'offline', qos: 1, retain: true },
    };
    if (this.settings.username) options.username = this.settings.username;
    if (this.settings.password) options.password = this.settings.password;

    let client: mqtt.MqttClient;
    try {
      client = mqtt.connect(brokerUrl, options);
    } catch (error) {
      this.setConnectionState('error', error instanceof Error ? error.message : String(error));
      return;
    }
    this.client = client;

    client.on('connect', () => {
      if (this.client !== client) return;
      client.publish(availabilityTopic, 'online', { qos: 1, retain: true });
      this.setConnectionState('connected');
    });

    client.on('error', (error) => {
      if (this.client !== client) return;
      this.setConnectionState('error', error?.message || 'Unknown error');
      // Without auto-reconnect mqtt.js stays half-open after a fatal error.
      if (!this.settings.autoReconnect) this.teardown();
    });

    client.on('reconnect', () => {
      if (this.client !== client) return;
      this.setConnectionState('connecting');
    });

    client.on('close', () => {
      if (this.client !== client) return;
      if (this.connectionState === 'connected') this.setConnectionState('disconnected');
      if (!this.settings.autoReconnect && this.connectionState === 'connecting') {
        this.setConnectionState('disconnected');
      }
    });

    client.on('message', (topic, payload) => {
      if (this.client !== client) return;
      this.onMessageCallback?.(topic, payload.toString());
    });
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.clearPending();
    if (!client) {
      this.setConnectionState('disconnected');
      return;
    }

    // Mark offline explicitly: a clean disconnect does not trigger the LWT.
    if (client.connected) {
      await new Promise<void>((resolve) => {
        client.publish(this.getAvailabilityTopic(), 'offline', { qos: 1, retain: true }, () => resolve());
        setTimeout(resolve, 1000);
      });
    }

    this.client = null;
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
      setTimeout(resolve, 2000);
    });
    client.removeAllListeners();
    this.setConnectionState('disconnected');
  }

  subscribe(topic: string) {
    if (!this.client) return;
    this.client.subscribe(topic, { qos: 1 }, (error) => {
      if (error) console.error(`[MQTT Plugin] Subscribe to ${topic} failed:`, error.message);
    });
  }

  unsubscribe(topic: string) {
    this.client?.unsubscribe(topic);
  }

  /**
   * Rate-limited publish. At most one message per topic every
   * `publishRateLimit` ms; intermediate values are coalesced and the latest
   * one is always sent, so the broker ends on the final slider position.
   */
  publish(topic: string, payload: string, opts: PublishOptions = {}): void {
    if (!this.isConnected()) return;

    const limit = Math.max(0, this.settings.publishRateLimit || 0);
    const elapsed = Date.now() - (this.lastPublishAt.get(topic) ?? 0);

    if (elapsed >= limit && !this.timers.has(topic)) {
      this.send(topic, payload, opts);
      return;
    }

    this.pending.set(topic, { payload, opts });
    if (!this.timers.has(topic)) {
      const timer = setTimeout(() => {
        this.timers.delete(topic);
        const next = this.pending.get(topic);
        this.pending.delete(topic);
        if (next && this.isConnected()) this.send(topic, next.payload, next.opts);
      }, Math.max(0, limit - elapsed));
      this.timers.set(topic, timer);
    }
  }

  /** Publish without rate limiting (discovery/config messages). */
  publishImmediate(topic: string, payload: string, opts: PublishOptions = {}): Promise<void> {
    if (!this.client || !this.isConnected()) {
      return Promise.reject(new Error('MQTT client not connected'));
    }
    return new Promise((resolve, reject) => {
      this.client!.publish(
        topic,
        payload,
        { qos: opts.qos ?? this.settings.qos, retain: opts.retain ?? false },
        (error) => (error ? reject(error) : resolve())
      );
    });
  }

  private send(topic: string, payload: string, opts: PublishOptions) {
    this.lastPublishAt.set(topic, Date.now());
    this.client?.publish(
      topic,
      payload,
      { qos: opts.qos ?? this.settings.qos, retain: opts.retain ?? false },
      (error) => {
        if (error) console.error(`[MQTT Plugin] Publish to ${topic} failed:`, error.message);
      }
    );
  }

  private clearPending() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  /** Drop the current client without emitting state changes. */
  private teardown() {
    this.clearPending();
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.on('error', () => {}); // swallow late errors from the dying socket
      client.end(true);
    }
  }

  private setConnectionState(state: ConnectionState, error?: string) {
    const changed = state !== this.connectionState;
    this.connectionState = state;
    // Only report transitions, so a broker that is down doesn't spam the UI
    // with an error toast on every reconnect attempt.
    if (changed) this.onConnectionChangeCallback?.(state, error);
  }
}
