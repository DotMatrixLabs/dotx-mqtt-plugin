# MQTT Publisher Plugin for Dot X

A Dot X plugin that publishes device slider values to an MQTT broker in real-time with Home Assistant integration support.

## Features

- **Real-time Publishing**: Automatically publishes device slider value changes to MQTT topics
- **Home Assistant Integration**: Built-in MQTT Discovery support for automatic sensor creation
- **Channel Selection**: Use the system utility button to select which channels to publish
- **Rate Limiting**: Configurable rate limiting to prevent broker flooding
- **Authentication**: Support for username/password authentication
- **SSL/TLS**: Secure connections with SSL/TLS support
- **Auto-reconnect**: Automatic reconnection on connection loss
- **QoS Levels**: Configurable Quality of Service (0, 1, or 2)

## Installation

### From Marketplace

Install directly through the Dot X plugin marketplace.

### Manual Installation

1. Download the latest `mqtt-plugin.dotxplugin` from the [Releases](https://github.com/ananords/dotx-mqtt-plugin/releases) page
2. Install it from the Dot X plugin settings
3. Enable the plugin, set your broker address, and press **Connect**

## Configuration

### Connection Settings

- **Broker IP Address**: IP address of your MQTT broker (e.g., `192.168.1.100`)
- **Broker Port**: Port number (default: `1883`, SSL: `8883`)
- **Topic Prefix**: Base topic for all messages (default: `dotx`)

### Authentication (Optional)

- **Username / Password**: MQTT broker credentials
- **Client ID**: Unique identifier for this client (auto-generated if not set)

### Advanced Settings

- **Enable SSL/TLS**: Use encrypted connection (remember to change port to 8883)
- **Keepalive Interval**: Seconds between keepalive packets (default: 60)
- **Quality of Service**: QoS 0 / 1 / 2
- **Clean Session**: Start with a clean session
- **Auto Reconnect**: Automatically reconnect on connection loss
- **Reconnect Interval**: Seconds between reconnection attempts (default: 5)
- **Publish Rate Limit**: Minimum milliseconds between publishes (default: 100)

### Channel Selection

- **Send All Channels**: All slider changes are published automatically
- **Use System Util Button**: Use the "MQTT Channels" button in the action mapper to toggle individual channels

### Home Assistant Integration

Requires the [MQTT integration](https://www.home-assistant.io/integrations/mqtt/) in Home Assistant, pointed at the same broker (e.g. the Mosquitto add-on).

Enable **Home Assistant Discovery** and each channel shows up as a sensor (0-100 %) under one **Dot X** device:

- Discovery topic: `homeassistant/sensor/dotx_device/ch{index}/config` (retained)
- Entities are created on the first slider movement after connecting (Dot X reports every channel on each update).
- While Dot X is closed or loses connection, entities show as **unavailable** (they are not deleted).
- When Home Assistant restarts, discovery is re-sent automatically (`homeassistant/status`).
- Turning the switch off removes the entities from Home Assistant.

## MQTT Topics

| Topic | Payload | Retained |
|---|---|---|
| `{topic_prefix}/channel/{index}` | `{"value": 75}` (0-100) | yes |
| `{topic_prefix}/status` | `online` / `offline` (offline is also the LWT) | yes |

`{index}` is the 0-based channel index (channel 1 in Dot X is `channel/0`). Only channels whose value changed are published. The publish rate limit applies per channel, and the last value is always delivered.

Connection settings (broker, port, credentials, topic prefix) apply the next time you press **Connect**.

## Development

```bash
npm install
npm run build      # one-shot build of main.js
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
npm run package    # build + dist/mqtt-plugin.dotxplugin
```

### Release

Push a version tag to trigger the GitHub Actions release workflow:

```bash
# Update version in manifest.json and package.json first
git tag v1.0.0
git push --tags
```

GitHub Actions verifies the tag matches the manifest/package version, then builds `dist/mqtt-plugin.dotxplugin` and attaches it to the release.

## License

MIT
