const { defineConfig } = require('@meteorjs/rspack');

/**
 * Rspack configuration for Meteor projects.
 *
 * Provides typed flags on the `Meteor` object, such as:
 * - `Meteor.isClient` / `Meteor.isServer`
 * - `Meteor.isDevelopment` / `Meteor.isProduction`
 * - …and other flags available
 *
 * Use these flags to adjust your build settings based on environment.
 */
module.exports = defineConfig(Meteor => {
  const config = {};

  if (Meteor.isServer) {
    config.module = {
      rules: [
        {
          test: /\.node$/,
          type: 'asset/resource',
        },
      ],
    };
    config.externals = [
      function ({ request }, callback) {
        // Externalize native node addons
        if (/node-datachannel/.test(request)) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      },
    ];
  }

  return config;
});
