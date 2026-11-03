import { MQTTClient } from './mqtt-client';
import { HASensorConfig } from './types';

export const HA_DISCOVERY_PREFIX = 'homeassistant';
export const HA_STATUS_TOPIC = `${HA_DISCOVERY_PREFIX}/status`;

/**
 * Home Assistant MQTT Discovery for the device's channels.
 *
 * Discovery configs are retained so entities survive broker and HA restarts,
 * and reference the plugin's availability topic so HA shows them as
 * "unavailable" (not deleted) while Dot X is closed.
 */
export class HomeAssistantDiscovery {
  private discoveredChannels = new Set<number>();
  private purging = false;

  constructor(
    private mqttClient: MQTTClient,
    private topicPrefix: string,
    private deviceName = 'Dot X',
    private deviceModel = 'Decker',
    private deviceId = 'dotx_device'
  ) {}

  updateTopicPrefix(topicPrefix: string) {
    if (topicPrefix !== this.topicPrefix) {
      this.topicPrefix = topicPrefix;
      this.discoveredChannels.clear();
    }
  }

  updateDeviceInfo(deviceName: string) {
    if (deviceName && deviceName !== this.deviceModel) {
      this.deviceModel = deviceName;
      this.discoveredChannels.clear();
    }
  }

  getStateTopic(channelIndex: number): string {
    return `${this.topicPrefix}/channel/${channelIndex}`;
  }

  private getDiscoveryTopic(channelIndex: number): string {
    return `${HA_DISCOVERY_PREFIX}/sensor/${this.deviceId}/ch${channelIndex}/config`;
  }

  private generateSensorConfig(channelIndex: number): HASensorConfig {
    return {
      // Shown in HA as "<device name> Channel N"; channels are 1-based for humans.
      name: `Channel ${channelIndex + 1}`,
      unique_id: `${this.deviceId}_channel_${channelIndex}`,
      state_topic: this.getStateTopic(channelIndex),
      availability_topic: this.mqttClient.getAvailabilityTopic(),
      payload_available: 'online',
      payload_not_available: 'offline',
      unit_of_measurement: '%',
      state_class: 'measurement',
      icon: 'mdi:tune-vertical',
      value_template: '{{ value_json.value }}',
      device: {
        identifiers: [this.deviceId],
        name: this.deviceName,
        manufacturer: 'DotMatrixLabs',
        model: this.deviceModel,
      },
    };
  }

  /** Publish discovery for a channel the first time it is seen. */
  async ensureDiscovered(channelIndex: number): Promise<void> {
    if (this.discoveredChannels.has(channelIndex)) return;
    await this.publishDiscovery(channelIndex);
  }

  async publishDiscovery(channelIndex: number): Promise<void> {
    this.purging = false; // re-enabled mid-purge: don't clear what we publish now
    const payload = JSON.stringify(this.generateSensorConfig(channelIndex));
    await this.mqttClient.publishImmediate(this.getDiscoveryTopic(channelIndex), payload, { qos: 1, retain: true });
    this.discoveredChannels.add(channelIndex);
  }

  async publishDiscoveryForChannels(channels: number[]): Promise<void> {
    await Promise.all(channels.map((ch) => this.publishDiscovery(ch)));
  }

  /** Wildcard matching every discovery config this plugin publishes. */
  getDiscoveryWildcard(): string {
    return `${HA_DISCOVERY_PREFIX}/sensor/${this.deviceId}/+/config`;
  }

  isOwnDiscoveryTopic(topic: string): boolean {
    return topic.startsWith(`${HA_DISCOVERY_PREFIX}/sensor/${this.deviceId}/`) && topic.endsWith('/config');
  }

  /**
   * Remove our entities from HA by clearing their retained discovery configs.
   *
   * The broker is the source of truth: after a restart the plugin doesn't know
   * which channels it announced earlier, so subscribe to our discovery topics,
   * clear every retained config the broker hands back, then unsubscribe.
   * Only used when the integration is off, not on every disconnect.
   */
  purgeDiscovery(windowMs = 2000) {
    const wildcard = this.getDiscoveryWildcard();
    this.purging = true;
    this.discoveredChannels.clear();
    this.mqttClient.subscribe(wildcard);
    setTimeout(() => {
      this.purging = false;
      this.mqttClient.unsubscribe(wildcard);
    }, windowMs);
  }

  /** Feed broker messages here; returns true if the message was handled. */
  handleMessage(topic: string, payload: string): boolean {
    if (!this.isOwnDiscoveryTopic(topic)) return false;
    if (this.purging && payload) {
      this.mqttClient
        .publishImmediate(topic, '', { qos: 1, retain: true })
        .catch((error) => console.error(`[MQTT Plugin] Clearing ${topic} failed:`, error));
    }
    return true;
  }

  /** Forget what was announced, e.g. after reconnecting or an HA restart. */
  reset() {
    this.discoveredChannels.clear();
  }
}
