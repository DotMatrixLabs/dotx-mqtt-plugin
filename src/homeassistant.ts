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
      object_id: `${this.deviceId}_channel_${channelIndex + 1}`,
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
    const payload = JSON.stringify(this.generateSensorConfig(channelIndex));
    await this.mqttClient.publishImmediate(this.getDiscoveryTopic(channelIndex), payload, { qos: 1, retain: true });
    this.discoveredChannels.add(channelIndex);
  }

  async publishDiscoveryForChannels(channels: number[]): Promise<void> {
    await Promise.all(channels.map((ch) => this.publishDiscovery(ch)));
  }

  /**
   * Remove the entities from HA (empty retained payload). Only used when the
   * user turns the integration off, not on every disconnect.
   */
  async removeDiscoveryForChannels(channels: number[]): Promise<void> {
    await Promise.all(
      channels.map((ch) =>
        this.mqttClient.publishImmediate(this.getDiscoveryTopic(ch), '', { qos: 1, retain: true })
      )
    );
    channels.forEach((ch) => this.discoveredChannels.delete(ch));
  }

  /** Forget what was announced, e.g. after reconnecting or an HA restart. */
  reset() {
    this.discoveredChannels.clear();
  }
}
