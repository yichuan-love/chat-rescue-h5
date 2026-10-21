'use strict';

// Vercel 独立函数：/api/analyze
// server.js 被 require 时不会 listen，只导出 Express app。
module.exports = require('../server');
