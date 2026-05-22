import { MQTTClient } from './mqtt-client';
import { HASensorConfig } from './types';

/**
 * Home Assistant MQTT Discovery manager
 */
export class HomeAssistantDiscovery {
  private mqttClient: MQTTClient;
  private topicPrefix: string;
  private deviceName: string;
  private deviceId: string;
  private discoveredChannels: Set<number> = new Set();

  constructor(
    mqttClient: MQTTClient,
    topicPrefix: string,
    deviceName: string = 'DotX Device',
    deviceId: string = 'dotx_device'
  ) {
    this.mqttClient = mqttClient;
    this.topicPrefix = topicPrefix;
    this.deviceName = deviceName;
    this.deviceId = deviceId;
  }

  updateTopicPrefix(topicPrefix: string) {
    this.topicPrefix = topicPrefix;
  }

  updateDeviceInfo(deviceName: string, devicePort: string) {
    this.deviceName = deviceName;
  }

  private generateSensorConfig(channelIndex: number): HASensorConfig {
    const uniqueId = `${this.deviceId}_channel_${channelIndex}`;
    const stateTopic = `${this.topicPrefix}/channel/${channelIndex}`;

    return {
      name: `${this.deviceName} Channel ${channelIndex}`,
      unique_id: uniqueId,
      state_topic: stateTopic,
      unit_of_measurement: '%',
      value_template: '{{ value_json.value }}',
      device: {
        identifiers: [this.deviceId],
        name: this.deviceName,
        manufacturer: 'DotMatrixLabs',
        model: 'Decker'
      }
    };
  }

  private getDiscoveryTopic(channelIndex: number): string {
    return `homeassistant/sensor/${this.deviceId}/ch${channelIndex}/config`;
  }

  getStateTopic(channelIndex: number): string {
    return `${this.topicPrefix}/channel/${channelIndex}`;
  }

  async publishDiscovery(channelIndex: number): Promise<void> {
    if (!this.mqttClient.isConnected()) {
      throw new Error('MQTT client not connected');
    }

    const discoveryTopic = this.getDiscoveryTopic(channelIndex);
    const config = this.generateSensorConfig(channelIndex);
    const payload = JSON.stringify(config);

    await this.mqttClient.publishImmediate(discoveryTopic, payload, 1);
    this.discoveredChannels.add(channelIndex);
  }

  async removeDiscovery(channelIndex: number): Promise<void> {
    if (!this.mqttClient.isConnected()) {
      return; // Can't remove if not connected
    }

    const discoveryTopic = this.getDiscoveryTopic(channelIndex);

    // Send empty payload to remove discovery
    await this.mqttClient.publishImmediate(discoveryTopic, '', 1);
    this.discoveredChannels.delete(channelIndex);
  }

  async publishDiscoveryForChannels(channels: number[]): Promise<void> {
    const promises = channels.map(ch => this.publishDiscovery(ch));
    await Promise.all(promises);
  }

  async removeAllDiscoveries(): Promise<void> {
    const channels = Array.from(this.discoveredChannels);
    const promises = channels.map(ch => this.removeDiscovery(ch));
    await Promise.all(promises);
  }

  async publishState(channelIndex: number, value: number): Promise<void> {
    if (!this.mqttClient.isConnected()) {
      throw new Error('MQTT client not connected');
    }

    // Ensure discovery is published for this channel
    if (!this.discoveredChannels.has(channelIndex)) {
      await this.publishDiscovery(channelIndex);
    }

    const stateTopic = this.getStateTopic(channelIndex);
    const payload = JSON.stringify({ value: value.toFixed(2) });

    await this.mqttClient.publish(stateTopic, payload);
  }

  getDiscoveredChannels(): number[] {
    return Array.from(this.discoveredChannels);
  }

  clearTracking() {
    this.discoveredChannels.clear();
  }
}
