const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

const LOCAL_FALLBACKS = {
  'accounts.local': 'accounts.example',
  'upiMerchants.local': 'upiMerchants.example',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [localName, exampleName] of Object.entries(LOCAL_FALLBACKS)) {
    if (moduleName.includes(localName)) {
      const basedir = path.dirname(context.originModulePath);
      const localPath = path.resolve(basedir, path.basename(moduleName));
      const candidates = [
        localPath,
        localPath + '.js',
        localPath.replace(/\.js$/, '') + '.js',
      ];
      const exists = candidates.some((p) => fs.existsSync(p));
      if (!exists) {
        const fallback = moduleName.replace(localName, exampleName);
        return context.resolveRequest(context, fallback, platform);
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
