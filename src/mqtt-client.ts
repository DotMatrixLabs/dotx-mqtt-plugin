import * as mqtt from 'mqtt';
import { MQTTSettings, ConnectionState } from './types';

/**
 * MQTT Client wrapper with connection management and rate limiting
 */
export class MQTTClient {
  private client: mqtt.MqttClient | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private lastPublishTime: number = 0;
  private settings: MQTTSettings;

  // Callbacks
  private onConnectionChangeCallback?: (state: ConnectionState, error?: string) => void;

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
    return this.connectionState === 'connected';
  }

  onConnectionChange(callback: (state: ConnectionState, error?: string) => void) {
    this.onConnectionChangeCallback = callback;
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      try {
        this.setConnectionState('connecting');

        const protocol = this.settings.useSsl ? 'mqtts' : 'mqtt';
        const brokerUrl = `${protocol}://${this.settings.brokerIP}:${this.settings.brokerPort}`;

        const options: mqtt.IClientOptions = {
          clientId: this.settings.clientId,
          keepalive: this.settings.keepalive,
          clean: this.settings.cleanSession,
          reconnectPeriod: this.settings.autoReconnect ? this.settings.reconnectInterval * 1000 : 0,
        };

        // Add authentication if provided
        if (this.settings.username) {
          options.username = this.settings.username;
        }
        if (this.settings.password) {
          options.password = this.settings.password;
        }

        this.client = mqtt.connect(brokerUrl, options);

        // Connection successful
        this.client.on('connect', () => {
          this.setConnectionState('connected');
          resolve();
        });

        // Connection error
        this.client.on('error', (error) => {
          const errorMsg = error.message || 'Unknown error';
          this.setConnectionState('error', errorMsg);
          reject(new Error(errorMsg));
        });

        // Connection closed
        this.client.on('close', () => {
          if (this.connectionState === 'connected') {
            this.setConnectionState('disconnected');
          }
        });

        // Reconnecting
        this.client.on('reconnect', () => {
          this.setConnectionState('connecting');
        });

        // Offline
        this.client.on('offline', () => {
          if (this.connectionState === 'connected') {
            this.setConnectionState('disconnected');
          }
        });

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Connection failed';
        this.setConnectionState('error', errorMsg);
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(true, {}, () => {
          this.client = null;
          this.setConnectionState('disconnected');
          resolve();
        });
      } else {
        this.setConnectionState('disconnected');
        resolve();
      }
    });
  }

  async publish(topic: string, payload: string | Buffer, qos?: 0 | 1 | 2): Promise<void> {
    if (!this.client || !this.isConnected()) {
      throw new Error('MQTT client not connected');
    }

    // Apply rate limiting
    const now = Date.now();
    const timeSinceLastPublish = now - this.lastPublishTime;

    if (timeSinceLastPublish < this.settings.publishRateLimit) {
      // Skip this publish to avoid flooding
      return;
    }

    this.lastPublishTime = now;

    return new Promise((resolve, reject) => {
      const publishQos = qos !== undefined ? qos : this.settings.qos;

      this.client!.publish(topic, payload, { qos: publishQos }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // publishImmediate bypasses rate limiting — used for discovery messages
  async publishImmediate(topic: string, payload: string | Buffer, qos?: 0 | 1 | 2): Promise<void> {
    if (!this.client || !this.isConnected()) {
      throw new Error('MQTT client not connected');
    }

    return new Promise((resolve, reject) => {
      const publishQos = qos !== undefined ? qos : this.settings.qos;

      this.client!.publish(topic, payload, { qos: publishQos }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private setConnectionState(state: ConnectionState, error?: string) {
    this.connectionState = state;
    if (this.onConnectionChangeCallback) {
      this.onConnectionChangeCallback(state, error);
    }
  }
}
