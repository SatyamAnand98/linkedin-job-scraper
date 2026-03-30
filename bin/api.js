#!/usr/bin/env node

import { startApiServer } from '../src/api/main.js';

const { config } = await startApiServer();
console.log(`LinkedIn Jobs API listening on http://${config.api.host}:${config.api.port}`);
