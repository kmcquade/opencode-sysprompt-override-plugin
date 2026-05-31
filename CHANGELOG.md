## [0.2.5](https://github.com/kmcquade/opencode-sysprompt-override-plugin/compare/v0.2.4...v0.2.5) (2026-05-31)


### Bug Fixes

* **errors:** escape backslashes before quotes in formatStderrLine ([#13](https://github.com/kmcquade/opencode-sysprompt-override-plugin/issues/13)) ([a298d8a](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/a298d8a1458b18feeb5a090161b02715c0612cfa))

## [0.2.4](https://github.com/kmcquade/opencode-sysprompt-override-plugin/compare/v0.2.3...v0.2.4) (2026-05-30)


### Bug Fixes

* **ci:** bump setup-node to v6 + keep registry-url for npm OIDC ([#10](https://github.com/kmcquade/opencode-sysprompt-override-plugin/issues/10)) ([763f86c](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/763f86c7a178bb2de5475495282b3025018ca0d5)), closes [actions/setup-node#1440](https://github.com/actions/setup-node/issues/1440)

## [0.2.3](https://github.com/kmcquade/opencode-sysprompt-override-plugin/compare/v0.2.2...v0.2.3) (2026-05-30)


### Bug Fixes

* **ci:** drop registry-url so npm publishes via OIDC, not a placeholder token ([#9](https://github.com/kmcquade/opencode-sysprompt-override-plugin/issues/9)) ([1a616cf](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/1a616cf467d6d76cf1fa3f89f161c38283b36f22))

## [0.2.2](https://github.com/kmcquade/opencode-sysprompt-override-plugin/compare/v0.2.1...v0.2.2) (2026-05-30)


### Bug Fixes

* **ci:** run publish job in the publish environment for npm OIDC ([#8](https://github.com/kmcquade/opencode-sysprompt-override-plugin/issues/8)) ([867bb33](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/867bb330da662f406c2dcf73167999f718084dac))

## [0.2.1](https://github.com/kmcquade/opencode-sysprompt-override-plugin/compare/v0.2.0...v0.2.1) (2026-05-30)


### Bug Fixes

* **errors:** report every config/rule error to stderr via console.error ([#7](https://github.com/kmcquade/opencode-sysprompt-override-plugin/issues/7)) ([047ecb1](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/047ecb141aaae7593897e0cebf4daa1fe958a89d))

# [0.2.0](https://github.com/kmcquade/opencode-sysprompt-override-plugin/compare/v0.1.0...v0.2.0) (2026-05-18)


### Bug Fixes

* **ci:** split semantic-release/npm into version-bump + exec for OIDC publish ([#6](https://github.com/kmcquade/opencode-sysprompt-override-plugin/issues/6)) ([4b56da4](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/4b56da4d6c09561569c350a8164e76c40a855295))


### Features

* add automated npm publish via semantic-release ([e58d412](https://github.com/kmcquade/opencode-sysprompt-override-plugin/commit/e58d4129384273a0fbc4949465ed9a9f1adf1d70))
