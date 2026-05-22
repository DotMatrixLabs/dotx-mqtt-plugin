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
  state_topic: string;
  unit_of_measurement: string;
  value_template: string;
  device: {
    identifiers: string[];
    name: string;
    manufacturer: string;
    model: string;
  };
}

export interface DeviceUpdateData {
  changes: Array<{
    index: number;
    oldValue: number;
    newValue: number;
  }>;
  values: Array<{ value: number }>;
}
