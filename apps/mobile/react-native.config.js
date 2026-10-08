const config = {
  commands: require("@callstack/repack/commands/rspack")
};

if (!config.dependencies) config.dependencies = {};

config.dependencies["react-native-vector-icons"] = {
  platforms: {
    ios: null
  }
};

module.exports = config;
