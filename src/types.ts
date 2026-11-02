export interface MQTTSettings {
  // Connection
  brokerIP: string;
  brokerPort: number;
  topicPrefix: string;

  // Authentication
  username: string;
  password: string;
  clientId: string;

  // Advanced
  useSsl: boolean;
  keepalive: number;
  qos: 0 | 1 | 2;
  cleanSession: boolean;
  autoReconnect: boolean;
  reconnectInterval: number;
  publishRateLimit: number;

  // Home Assistant
  homeAssistantEnabled: boolean;

  // Channel selection
  channelSelectionMode: 'all' | 'button';

  // Connection behavior
  autoConnect: boolean;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface HASensorConfig {
  name: string;
  unique_id: string;
  object_id: string;
  state_topic: string;
  availability_topic: string;
  payload_available: string;
  payload_not_available: string;
  unit_of_measurement: string;
  state_class: string;
  icon: string;
  value_template: string;
  device: {
    identifiers: string[];
    name: string;
    manufacturer: string;
    model: string;
  };
}

/**
 * Payload Dot X actually sends on `plugin.device_update`.
 *
 * Dot X emits `{ changes, sliders }`: `changes` contains one entry per slider
 * (including unchanged ones) with values already scaled to 0-100. The SDK's
 * `DeviceChanges` type declares a `values` array that the app never sends,
 * so don't rely on it.
 */
export interface DeviceUpdateData {
  changes: Array<{
    index: number;
    oldValue: number;
    newValue: number;
  }>;
  sliders?: number[];
  values?: Array<{ value: number }>;
}
