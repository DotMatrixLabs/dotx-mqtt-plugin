import Plugin, { runPlugin } from "@dotmatrixlabs/dotx-plugin-sdk";
import { MQTTClient } from "./src/mqtt-client";
import { HomeAssistantDiscovery, HA_STATUS_TOPIC } from "./src/homeassistant";
import { buildSettingsUI } from "./src/settings";
import { MQTTSettings, ConnectionState, DeviceUpdateData } from "./src/types";

type SystemUtilButtonHandle = ReturnType<Plugin["actionmapper"]["addSystemUtilButton"]>;

export default class MQTTPlugin extends Plugin {
  private settings!: MQTTSettings;
  private mqttClient!: MQTTClient;
  private haDiscovery!: HomeAssistantDiscovery;
  private channelButton!: SystemUtilButtonHandle;
  private settingsUIUpdateFn?: (state: ConnectionState) => void;
  private updateChannelsListFn?: () => void;

  /** Latest known value (0-100) per channel index. */
  private channelValues: number[] = [];
  /** Whether we have been connected since the last error toast. */
  private errorToastShown = false;
  private wasConnected = false;

  async onLoad() {
    console.log("[MQTT Plugin] Loading...");

    this.initConfig();
    this.loadSettings();

    this.mqttClient = new MQTTClient(this.settings);
    this.haDiscovery = new HomeAssistantDiscovery(this.mqttClient, this.settings.topicPrefix);

    this.mqttClient.onConnectionChange((state, error) => this.handleConnectionChange(state, error));
    this.mqttClient.onMessage((topic, payload) => {
      if (this.haDiscovery.handleMessage(topic, payload)) return;
      // Home Assistant announces itself after a restart; re-send discovery.
      if (topic === HA_STATUS_TOPIC && payload === 'online' && this.settings.homeAssistantEnabled) {
        console.log("[MQTT Plugin] Home Assistant came online, re-publishing discovery");
        this.haDiscovery.reset();
        this.publishAllKnownChannels();
      }
    });

    this.channelButton = this.actionmapper
      .addSystemUtilButton('mqttChannelSelect')
      .setTitle('MQTT Channel')
      .setIcon('fas fa-lg fa-network-wired')
      .setHidden(this.settings.channelSelectionMode === 'all')
      .onClick(({ selected, channel }) => {
        console.log(`[MQTT Plugin] Channel ${channel} ${selected ? 'selected' : 'deselected'}`);
        const index = Number(channel);
        if (selected && Number.isInteger(index) && this.channelValues[index] !== undefined) {
          this.publishChannel(index, this.channelValues[index]);
        }
        this.updateChannelsListFn?.();
      });

    await this.settingsPage.addSettings((settings) => {
      const ui = buildSettingsUI(
        settings,
        this.settings,
        () => this.mqttClient.getState(),
        (newSettings) => this.handleSaveSettings(newSettings),
        () => this.handleConnect(),
        () => this.handleDisconnect(),
        this.channelButton
      );
      this.settingsUIUpdateFn = ui.updateConnectionState;
      this.updateChannelsListFn = ui.updateChannelsSelectedList;
    });

    this.device.onUpdate((data) => this.handleDeviceUpdate(data as unknown as DeviceUpdateData));

    if (this.settings.autoConnect) {
      console.log("[MQTT Plugin] Auto-connecting...");
      this.handleConnect();
    }

    console.log("[MQTT Plugin] Loaded successfully!");
  }

  private handleConnectionChange(state: ConnectionState, error?: string) {
    console.log(`[MQTT Plugin] Connection state: ${state}`, error || '');
    this.settingsUIUpdateFn?.(state);

    if (state === 'connected') {
      this.wasConnected = true;
      this.errorToastShown = false;
      this.toast({ message: 'Connected to MQTT broker', type: 'success', duration: 3000 });
      if (this.settings.homeAssistantEnabled) {
        this.mqttClient.subscribe(HA_STATUS_TOPIC);
        this.haDiscovery.reset();
      } else {
        // Also covers turning discovery off while disconnected.
        this.haDiscovery.purgeDiscovery();
      }
      this.publishAllKnownChannels();
    } else if (state === 'disconnected' && this.wasConnected) {
      this.wasConnected = false;
      this.toast({ message: 'Disconnected from MQTT broker', type: 'info', duration: 3000 });
    } else if (state === 'error' && !this.errorToastShown) {
      this.errorToastShown = true;
      this.wasConnected = false;
      this.toast({
        message: `MQTT connection error: ${error || 'Unknown error'}`,
        type: 'error',
        duration: 5000,
      });
    }
  }

  /** Toast without risking an unhandled rejection (fatal under Deno). */
  private toast(params: Parameters<Plugin["ui"]["showToast"]>[0]) {
    this.ui.showToast(params).catch((error) => console.error("[MQTT Plugin] Toast failed:", error));
  }

  private handleDeviceUpdate(data: DeviceUpdateData) {
    // Dot X sends every slider in `changes` on each update; publish only the
    // ones that actually moved. (`values` from the SDK type is never sent.)
    const changes = Array.isArray(data?.changes) ? data.changes : [];
    for (const { index, newValue } of changes) {
      if (!Number.isInteger(index) || typeof newValue !== 'number') continue;
      if (this.channelValues[index] === newValue) continue;
      this.channelValues[index] = newValue;
      this.publishChannel(index, newValue);
    }
  }

  private isChannelEnabled(index: number): boolean {
    return this.settings.channelSelectionMode === 'all' || this.channelButton.isSelected(index);
  }

  private publishChannel(index: number, value: number) {
    if (!this.mqttClient.isConnected() || !this.isChannelEnabled(index)) return;

    if (this.settings.homeAssistantEnabled) {
      this.haDiscovery.ensureDiscovered(index).catch((error) =>
        console.error(`[MQTT Plugin] HA discovery for channel ${index} failed:`, error)
      );
    }

    const topic = `${this.settings.topicPrefix}/channel/${index}`;
    this.mqttClient.publish(topic, JSON.stringify({ value }), { retain: true });
  }

  /** Re-send discovery and the current value of every known channel. */
  private publishAllKnownChannels() {
    this.channelValues.forEach((value, index) => {
      if (value !== undefined) this.publishChannel(index, value);
    });
  }


  private handleSaveSettings(newSettings: MQTTSettings) {
    const previous = this.settings;
    this.settings = newSettings;
    this.config.set('settings', this.settings);

    this.mqttClient.updateSettings(this.settings);
    this.haDiscovery.updateTopicPrefix(this.settings.topicPrefix);
    this.channelButton.setHidden(this.settings.channelSelectionMode === 'all');

    // Apply Home Assistant toggle immediately when connected.
    if (this.mqttClient.isConnected() && previous.homeAssistantEnabled !== newSettings.homeAssistantEnabled) {
      if (newSettings.homeAssistantEnabled) {
        this.mqttClient.subscribe(HA_STATUS_TOPIC);
        this.haDiscovery.reset();
        this.publishAllKnownChannels();
      } else {
        this.mqttClient.unsubscribe(HA_STATUS_TOPIC);
        this.haDiscovery.purgeDiscovery();
      }
    }
  }

  private handleConnect() {
    console.log(`[MQTT Plugin] Connecting to ${this.settings.brokerIP}:${this.settings.brokerPort}...`);
    this.errorToastShown = false;
    this.mqttClient.connect();
  }

  private async handleDisconnect() {
    console.log("[MQTT Plugin] Disconnecting from MQTT broker...");
    try {
      await this.mqttClient.disconnect();
    } catch (error) {
      console.error("[MQTT Plugin] Disconnect failed:", error);
    }
  }

  private loadSettings() {
    const saved = this.config.get('settings') || {};
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

    this.settings = {
      brokerIP: saved.brokerIP || '192.168.1.100',
      brokerPort: num(saved.brokerPort, 1883) || 1883,
      topicPrefix: saved.topicPrefix || 'dotx',
      username: saved.username || '',
      password: saved.password || '',
      clientId: saved.clientId || `dotx-mqtt-${Math.random().toString(36).slice(2, 11)}`,
      useSsl: saved.useSsl === true,
      keepalive: num(saved.keepalive, 60),
      qos: ([0, 1, 2].includes(saved.qos) ? saved.qos : 0) as 0 | 1 | 2,
      cleanSession: saved.cleanSession !== false,
      autoReconnect: saved.autoReconnect !== false,
      reconnectInterval: num(saved.reconnectInterval, 5) || 5,
      publishRateLimit: num(saved.publishRateLimit, 100),
      homeAssistantEnabled: saved.homeAssistantEnabled === true,
      channelSelectionMode: saved.channelSelectionMode === 'button' ? 'button' : 'all',
      autoConnect: saved.autoConnect === true,
    };

    // Persist a generated client ID so it is stable across restarts.
    if (saved.clientId !== this.settings.clientId) {
      this.config.set('settings', this.settings);
    }
  }

  private initConfig() {
    this.config.init({
      schema: {
        settings: {
          type: "object",
          properties: {
            brokerIP: { type: "string", default: "192.168.1.100", description: "MQTT broker IP address" },
            brokerPort: { type: "number", default: 1883, description: "MQTT broker port" },
            topicPrefix: { type: "string", default: "dotx", description: "Base topic prefix" },
            username: { type: "string", default: "", description: "MQTT username" },
            password: { type: "string", default: "", description: "MQTT password" },
            clientId: { type: "string", default: "", description: "MQTT client ID" },
            useSsl: { type: "boolean", default: false, description: "Use SSL/TLS" },
            keepalive: { type: "number", default: 60, description: "Keepalive interval in seconds" },
            qos: { type: "number", default: 0, description: "Quality of Service level" },
            cleanSession: { type: "boolean", default: true, description: "Clean session flag" },
            autoReconnect: { type: "boolean", default: true, description: "Auto reconnect on connection loss" },
            reconnectInterval: { type: "number", default: 5, description: "Reconnect interval in seconds" },
            publishRateLimit: { type: "number", default: 100, description: "Publish rate limit in milliseconds" },
            homeAssistantEnabled: { type: "boolean", default: false, description: "Enable Home Assistant discovery" },
            channelSelectionMode: { type: "string", default: "all", description: "Channel selection mode: all or button" },
            autoConnect: { type: "boolean", default: false, description: "Auto connect on startup" },
          },
        },
      },
    });
  }

  async onUnload() {
    console.log("[MQTT Plugin] Unloading...");
    try {
      // Publishes "offline" so HA marks entities unavailable rather than deleting them.
      await this.mqttClient.disconnect();
    } catch (error) {
      console.error("[MQTT Plugin] Error during unload:", error);
    }
    console.log("[MQTT Plugin] Unloaded");
  }
}

// Run the plugin when executed directly
if (require.main === module) {
  runPlugin(MQTTPlugin);
}
