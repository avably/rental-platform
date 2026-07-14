import baseConfig from "../../eslint.config.mjs";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [...baseConfig, ...nextCoreWebVitals];

export default config;
