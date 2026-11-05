'use strict';

/**
 * 技术指标策略引擎
 *
 * - 自研公式 DSL：tokenizer → 递归下降解析器 → AST → 求值（禁止 eval / new Function）
 * - 指标库（src/indicators.js）：MA/EMA/REF/HHV/LLV/SUM/STD/ABS/MAX/MIN/CROSS/CROSSDOWN/
 *   RSI/DIF/DEA/MACD_HIST/KDJ_K/KDJ_D/BOLL_MID/BOLL_UPPER/BOLL_LOWER/TD_BUY/TD_SELL
 * - 信号回测：stock/ETF 用后复权日线（含 OHLCV），基金用净值；T 日信号 T+1 开盘成交；
 *   止损/止盈、权益曲线、回撤、沪深300 基准、交易明细、买卖点、当前持仓/信号
 *
 * 接口：GET /api/strategy/templates、GET|POST /api/strategy/validate、GET /api/strategy/backtest
 */

const { createCache, getFundInternal, round, downsample } = require('./fund');
const stocks = require('./stocks');
const ind = require('./indicators');

const cache = createCache(80);
const TTL = 5 * 60 * 1000;

const MAX_FORMULA_LENGTH = 4000;
const MAX_STATEMENTS = 50;
const MAX_NODES = 3000;
const MAX_DEPTH = 64;
const MAX_INT_ARG = 1000;

const BUILTIN_SERIES = new Set(['CLOSE', 'OPEN', 'HIGH', 'LOW', 'VOL', 'VOLUME', 'AMOUNT']);
const SERIES_KEY = { VOLUME: 'VOL' };

// 函数签名：args 允许的参数个数；series 为序列参数下标；ints 为必须正整数常量的下标；
// nums 为必须数字常量的下标；kdj 允许 3-6 个参数（缺省 9,3,3）
const FUNCTIONS = {
  MA: { args: [2, 2], series: [0], ints: [1] },
  EMA: { args: [2, 2], series: [0], ints: [1] },
  REF: { args: [2, 2], series: [0], ints: [1] },
  HHV: { args: [2, 2], series: [0], ints: [1] },
  LLV: { args: [2, 2], series: [0], ints: [1] },
  SUM: { args: [2, 2], series: [0], ints: [1] },
  STD: { args: [2, 2], series: [0], ints: [1] },
  ABS: { args: [1, 1], series: [0] },
  MAX: { args: [2, 2], series: [0, 1] },
  MIN: { args: [2, 2], series: [0, 1] },
  CROSS: { args: [2, 2], series: [0, 1] },
  CROSSDOWN: { args: [2, 2], series: [0, 1] },
  RSI: { args: [2, 2], series: [0], ints: [1] },
  DIF: { args: [3, 3], series: [0], ints: [1, 2] },
  DEA: { args: [4, 4], series: [0], ints: [1, 2, 3] },
  MACD_HIST: { args: [4, 4], series: [0], ints: [1, 2, 3] },
  KDJ_K: { args: [3, 6], series: [0, 1, 2], ints: [3, 4, 5], kdj: true },
  KDJ_D: { args: [3, 6], series: [0, 1, 2], ints: [3, 4, 5], kdj: true },
  BOLL_MID: { args: [2, 2], series: [0], ints: [1] },
  BOLL_UPPER: { args: [3, 3], series: [0], ints: [1], nums: [2], numRange: [0.1, 10] },
  BOLL_LOWER: { args: [3, 3], series: [0], ints: [1], nums: [2], numRange: [0.1, 10] },
  TD_BUY: { args: [1, 1], series: [0] },
  TD_SELL: { args: [1, 1], series: [0] },
};

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(String(value).replace(/[,，\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDate(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return null;
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// =====================================================================
// 一、Tokenizer
// =====================================================================

function tokenize(source) {
  const src = String(source === null || source === undefined ? '' : source);
  if (src.length > MAX_FORMULA_LENGTH) {
    throw new Error('公式过长（' + src.length + ' 字符，上限 ' + MAX_FORMULA_LENGTH + '）');
  }
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n' || ch === ';') {
      tokens.push({ type: 'sep', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const start = i;
      let hasDot = false;
      while (i < src.length && (/[0-9]/.test(src[i]) || (src[i] === '.' && !hasDot))) {
        if (src[i] === '.') hasDot = true;
        i += 1;
      }
      const raw = src.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('数字格式错误「' + raw + '」（位置 ' + (start + 1) + '）');
      tokens.push({ type: 'num', value, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i += 1;
      tokens.push({ type: 'ident', value: src.slice(start, i).toUpperCase(), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].indexOf(two) >= 0) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/%()<>=!,'.indexOf(ch) >= 0) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }
    throw new Error('无法识别的字符「' + ch + '」（位置 ' + (i + 1) + '）');
  }
  tokens.push({ type: 'eof', pos: src.length });
  return tokens;
}

// =====================================================================
// 二、递归下降解析器（AST）
// =====================================================================

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
    this.nodeCount = 0;
  }

  peek(offset) {
    const i = this.index + (offset || 0);
    return this.tokens[i] || this.tokens[this.tokens.length - 1];
  }

  next() {
    const token = this.tokens[this.index];
    if (this.index < this.tokens.length - 1) this.index += 1;
    return token;
  }

  matchOp(values) {
    const token = this.peek();
    return token.type === 'op' && values.indexOf(token.value) >= 0;
  }

  expectOp(value, message) {
    const token = this.peek();
    if (token.type !== 'op' || token.value !== value) {
      throw new Error(message + '（位置 ' + (token.pos + 1) + '）');
    }
    return this.next();
  }

  enter() {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new Error('表达式嵌套过深（超过 ' + MAX_DEPTH + ' 层）');
  }

  leave() {
    this.depth -= 1;
  }

  make(node) {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_NODES) throw new Error('公式过于复杂（AST 节点数超过 ' + MAX_NODES + '）');
    return node;
  }

  parseProgram() {
    const statements = [];
    for (;;) {
      while (this.peek().type === 'sep') this.next();
      if (this.peek().type === 'eof') break;
      statements.push(this.parseStatement());
      if (statements.length > MAX_STATEMENTS) {
        throw new Error('公式语句过多（上限 ' + MAX_STATEMENTS + ' 行）');
      }
      const token = this.peek();
      if (token.type !== 'sep' && token.type !== 'eof') {
        throw new Error('语句之间缺少分隔符（位置 ' + (token.pos + 1) + '）');
      }
    }
    if (!statements.length) throw new Error('公式为空');
    return { statements, nodeCount: this.nodeCount };
  }

  parseStatement() {
    const token = this.peek();
    if (token.type === 'ident' && this.peek(1).type === 'op' && this.peek(1).value === '=') {
      this.next();
      this.next();
      return this.make({ type: 'assign', name: token.value, expr: this.parseExpression(), pos: token.pos });
    }
    return { type: 'expr', expr: this.parseExpression() };
  }

  parseExpression() {
    this.enter();
    const expr = this.parseOr();
    this.leave();
    return expr;
  }

  parseOr() {
    let left = this.parseAnd();
    for (;;) {
      const token = this.peek();
      const isOr = (token.type === 'ident' && token.value === 'OR') || (token.type === 'op' && token.value === '||');
      if (!isOr) return left;
      this.next();
      const right = this.parseAnd();
      left = this.make({ type: 'bin', op: 'OR', left, right, pos: token.pos });
    }
  }

  parseAnd() {
    let left = this.parseNot();
    for (;;) {
      const token = this.peek();
      const isAnd = (token.type === 'ident' && token.value === 'AND') || (token.type === 'op' && token.value === '&&');
      if (!isAnd) return left;
      this.next();
      const right = this.parseNot();
      left = this.make({ type: 'bin', op: 'AND', left, right, pos: token.pos });
    }
  }

  parseNot() {
    const token = this.peek();
    if ((token.type === 'ident' && token.value === 'NOT') || (token.type === 'op' && token.value === '!')) {
      this.next();
      this.enter();
      const arg = this.parseNot();
      this.leave();
      return this.make({ type: 'unary', op: 'NOT', arg, pos: token.pos });
    }
    return this.parseComparison();
  }

  parseComparison() {
    const left = this.parseAdditive();
    const token = this.peek();
    if (token.type === 'op' && ['>', '>=', '<', '<=', '==', '!='].indexOf(token.value) >= 0) {
      this.next();
      const right = this.parseAdditive();
      return this.make({ type: 'bin', op: token.value, left, right, pos: token.pos });
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token.type !== 'op' || (token.value !== '+' && token.value !== '-')) return left;
      this.next();
      const right = this.parseMultiplicative();
      left = this.make({ type: 'bin', op: token.value, left, right, pos: token.pos });
    }
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.type !== 'op' || ['*', '/', '%'].indexOf(token.value) < 0) return left;
      this.next();
      const right = this.parseUnary();
      left = this.make({ type: 'bin', op: token.value, left, right, pos: token.pos });
    }
  }

  parseUnary() {
    const token = this.peek();
    if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
      this.next();
      this.enter();
      const arg = this.parseUnary();
      this.leave();
      if (token.value === '+') return arg;
      return this.make({ type: 'unary', op: '-', arg, pos: token.pos });
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === 'num') {
      this.next();
      return this.make({ type: 'num', value: token.value, pos: token.pos });
    }
    if (token.type === 'ident') {
      this.next();
      if (this.peek().type === 'op' && this.peek().value === '(') {
        this.next();
        const args = [];
        if (!(this.peek().type === 'op' && this.peek().value === ')')) {
          for (;;) {
            args.push(this.parseExpression());
            if (this.peek().type === 'op' && this.peek().value === ',') {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(')', '函数「' + token.value + '」缺少右括号');
        return this.make({ type: 'call', name: token.value, args, pos: token.pos });
      }
      return this.make({ type: 'ident', name: token.value, pos: token.pos });
    }
    if (token.type === 'op' && token.value === '(') {
      this.next();
      const expr = this.parseExpression();
      this.expectOp(')', '缺少右括号');
      return expr;
    }
    throw new Error('期望数字、变量、函数或括号，实际遇到「' + (token.type === 'eof' ? '公式结尾' : token.value) + '」（位置 ' + (token.pos + 1) + '）');
  }
}

function parseSource(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

// =====================================================================
// 三、语义分析（内置名/变量/call 参数/usesVolume）
// =====================================================================

function validateCallArgs(node, ctx) {
  const spec = FUNCTIONS[node.name];
  if (!spec) throw new Error('未知函数「' + node.name + '」（位置 ' + (node.pos + 1) + '）');

  // KDJ 允许省略 M1/M2（补默认 9,3,3）
  if (spec.kdj && node.args.length >= 3 && node.args.length < 6) {
    const defaults = [9, 3, 3];
    const append = defaults.slice(node.args.length - 3);
    for (const value of append) node.args.push({ type: 'num', value, pos: node.pos });
  }

  const minArgs = spec.args[0];
  const maxArgs = spec.args[1];
  if (node.args.length < minArgs || node.args.length > maxArgs) {
    throw new Error(
      '函数「' + node.name + '」参数个数不正确（需要 ' + (minArgs === maxArgs ? minArgs : minArgs + '-' + maxArgs) +
        ' 个，实际 ' + node.args.length + ' 个，位置 ' + (node.pos + 1) + '）'
    );
  }

  for (const argIndex of spec.ints || []) {
    const arg = node.args[argIndex];
    if (!arg || arg.type !== 'num' || !Number.isInteger(arg.value) || arg.value < 1 || arg.value > MAX_INT_ARG) {
      throw new Error(
        '函数「' + node.name + '」第 ' + (argIndex + 1) + ' 个参数必须是正整数常量（1-' + MAX_INT_ARG +
          '，位置 ' + (node.pos + 1) + '）'
      );
    }
  }

  for (const argIndex of spec.nums || []) {
    const arg = node.args[argIndex];
    const range = spec.numRange || [0.1, 10];
    if (!arg || arg.type !== 'num' || !Number.isFinite(arg.value) || arg.value < range[0] || arg.value > range[1]) {
      throw new Error(
        '函数「' + node.name + '」第 ' + (argIndex + 1) + ' 个参数必须是数字常量（' + range[0] + '-' + range[1] +
          '，位置 ' + (node.pos + 1) + '）'
      );
    }
  }

  for (const arg of node.args) {
    if (arg && arg.type !== 'num') walkExpr(arg, ctx);
  }
}

function walkExpr(node, ctx) {
  if (!node) throw new Error('内部错误：空表达式节点');
  if (node.type === 'num') return;
  if (node.type === 'ident') {
    if (node.name === 'VOL' || node.name === 'VOLUME' || node.name === 'AMOUNT') ctx.usesVolume = true;
    if (BUILTIN_SERIES.has(node.name)) return;
    if (ctx.variables.has(node.name)) return;
    if (FUNCTIONS[node.name]) throw new Error('函数「' + node.name + '」必须带括号调用（位置 ' + (node.pos + 1) + '）');
    throw new Error('未定义的变量「' + node.name + '」（位置 ' + (node.pos + 1) + '）');
  }
  if (node.type === 'call') {
    ctx.functions.add(node.name);
    validateCallArgs(node, ctx);
    return;
  }
  if (node.type === 'unary') {
    walkExpr(node.arg, ctx);
    return;
  }
  if (node.type === 'bin') {
    walkExpr(node.left, ctx);
    walkExpr(node.right, ctx);
    return;
  }
  throw new Error('内部错误：未知表达式节点类型「' + node.type + '」');
}

/**
 * 解析 + 校验单个公式
 * @param {string} source
 * @param {'buy'|'sell'|'validate'} mode
 */
function analyzeFormula(source, mode) {
  const text = String(source === null || source === undefined ? '' : source).trim();
  if (!text) throw new Error('公式不能为空');
  const ast = parseSource(text);
  const ctx = {
    variables: new Map(),
    functions: new Set(),
    usesVolume: false,
  };
  const executable = [];

  for (const stmt of ast.statements) {
    if (stmt.type === 'assign') {
      const name = stmt.name;
      if (BUILTIN_SERIES.has(name) || FUNCTIONS[name]) {
        throw new Error('变量名「' + name + '」与内置名称冲突（位置 ' + (stmt.pos + 1) + '）');
      }
      if (ctx.variables.has(name)) {
        throw new Error('变量「' + name + '」重复赋值（位置 ' + (stmt.pos + 1) + '）');
      }
      walkExpr(stmt.expr, ctx);
      ctx.variables.set(name, stmt.expr);
      executable.push({ type: 'assign', name, expr: stmt.expr });
    } else {
      walkExpr(stmt.expr, ctx);
      executable.push({ type: 'expr', expr: stmt.expr });
    }
  }

  const lastStmt = ast.statements[ast.statements.length - 1];
  let resultExpr = null;
  if (lastStmt && lastStmt.type === 'expr') {
    resultExpr = lastStmt.expr;
  } else {
    const order = mode === 'sell' ? ['SELL', 'RESULT', 'BUY'] : ['BUY', 'RESULT', 'SELL'];
    for (const name of order) {
      if (ctx.variables.has(name)) {
        resultExpr = ctx.variables.get(name);
        break;
      }
    }
  }
  if (!resultExpr) {
    throw new Error('缺少结果表达式：最后一行可写裸表达式，或定义 BUY / SELL / RESULT 变量');
  }

  return {
    executable,
    resultExpr,
    variables: [...ctx.variables.keys()],
    functions: [...ctx.functions],
    usesVolume: ctx.usesVolume,
    nodeCount: ast.nodeCount,
  };
}

/**
 * POST/GET /api/strategy/validate
 * @param {{buy?:string, sell?:string, assetType?:string}} payload
 */
function validateFormulas(payload) {
  const input = payload || {};
  const buy = String(input.buy === null || input.buy === undefined ? '' : input.buy);
  const sell = String(input.sell === null || input.sell === undefined ? '' : input.sell);
  const assetType = String(input.assetType || '').toLowerCase() === 'fund' ? 'fund' : 'stock';
  try {
    if (!buy.trim() && !sell.trim()) throw new Error('请提供 buy 或 sell 公式');
    const variables = new Set();
    const functions = new Set();
    let usesVolume = false;
    if (buy.trim()) {
      const info = analyzeFormula(buy, 'buy');
      info.variables.forEach((name) => variables.add(name));
      info.functions.forEach((name) => functions.add(name));
      usesVolume = usesVolume || info.usesVolume;
    }
    if (sell.trim()) {
      const info = analyzeFormula(sell, 'sell');
      info.variables.forEach((name) => variables.add(name));
      info.functions.forEach((name) => functions.add(name));
      usesVolume = usesVolume || info.usesVolume;
    }
    if (assetType === 'fund' && usesVolume) {
      throw new Error('该标的无成交量数据，不能使用 VOL/AMOUNT 指标');
    }
    return { ok: true, variables: [...variables], functions: [...functions], usesVolume };
  } catch (err) {
    return {
      ok: false,
      variables: [],
      functions: [],
      usesVolume: false,
      error: err && err.message ? err.message : String(err),
    };
  }
}

// =====================================================================
// 四、AST 求值
// =====================================================================

function truthy(value) {
  return Number.isFinite(value) && value !== 0;
}

function asSeries(value, n) {
  if (typeof value === 'number') {
    const out = new Float64Array(n);
    if (Number.isFinite(value)) out.fill(value);
    else out.fill(NaN);
    return out;
  }
  return value;
}

function mapUnary(value, fn) {
  if (typeof value === 'number') return fn(value);
  const out = new Float64Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = fn(value[i]);
  return out;
}

function computeScalar(op, x, y) {
  if (op === 'AND') return truthy(x) && truthy(y) ? 1 : 0;
  if (op === 'OR') return truthy(x) || truthy(y) ? 1 : 0;
  if (op === '+') return x + y;
  if (op === '-') return x - y;
  if (op === '*') return x * y;
  if (op === '/') return x / y;
  if (op === '%') return x % y;
  if (op === '>') return x > y ? 1 : 0;
  if (op === '>=') return x >= y ? 1 : 0;
  if (op === '<') return x < y ? 1 : 0;
  if (op === '<=') return x <= y ? 1 : 0;
  if (op === '==') return x === y ? 1 : 0;
  if (op === '!=') return x !== y ? 1 : 0;
  throw new Error('内部错误：未知运算符「' + op + '」');
}

function applyOp(op, a, b, n) {
  const aScalar = typeof a === 'number';
  const bScalar = typeof b === 'number';
  if (aScalar && bScalar) return computeScalar(op, a, b);
  const out = new Float64Array(n);
  if (aScalar) {
    for (let i = 0; i < n; i += 1) out[i] = computeScalar(op, a, b[i]);
  } else if (bScalar) {
    for (let i = 0; i < n; i += 1) out[i] = computeScalar(op, a[i], b);
  } else {
    for (let i = 0; i < n; i += 1) out[i] = computeScalar(op, a[i], b[i]);
  }
  return out;
}

function evalNode(node, ctx, vars, depth) {
  if (depth > MAX_DEPTH) throw new Error('公式求值嵌套过深（超过 ' + MAX_DEPTH + ' 层）');
  if (node.type === 'num') return node.value;
  if (node.type === 'ident') {
    const key = SERIES_KEY[node.name] || node.name;
    if (ctx.series[key]) return ctx.series[key];
    if (vars.has(node.name)) return vars.get(node.name);
    throw new Error('未定义的变量「' + node.name + '」（位置 ' + (node.pos + 1) + '）');
  }
  if (node.type === 'unary') {
    const value = evalNode(node.arg, ctx, vars, depth + 1);
    if (node.op === 'NOT') return mapUnary(value, (x) => (truthy(x) ? 0 : 1));
    return mapUnary(value, (x) => -x);
  }
  if (node.type === 'bin') {
    const a = evalNode(node.left, ctx, vars, depth + 1);
    const b = evalNode(node.right, ctx, vars, depth + 1);
    return applyOp(node.op, a, b, ctx.n);
  }
  if (node.type === 'call') return evalCall(node, ctx, vars, depth);
  throw new Error('内部错误：未知表达式节点');
}

function seriesArg(node, ctx, vars, depth) {
  return asSeries(evalNode(node, ctx, vars, depth + 1), ctx.n);
}

function evalCall(node, ctx, vars, depth) {
  const name = node.name;
  const args = node.args;
  const n = ctx.n;

  switch (name) {
    case 'MA':
      return ind.ma(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'EMA':
      return ind.ema(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'REF':
      return ind.ref(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'HHV':
      return ind.hhv(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'LLV':
      return ind.llv(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'SUM':
      return ind.sum(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'STD':
      return ind.std(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'ABS':
      return ind.abs(seriesArg(args[0], ctx, vars, depth), n);
    case 'MAX':
      return ind.max2(seriesArg(args[0], ctx, vars, depth), seriesArg(args[1], ctx, vars, depth));
    case 'MIN':
      return ind.min2(seriesArg(args[0], ctx, vars, depth), seriesArg(args[1], ctx, vars, depth));
    case 'CROSS':
      return ind.cross(seriesArg(args[0], ctx, vars, depth), seriesArg(args[1], ctx, vars, depth));
    case 'CROSSDOWN':
      return ind.crossdown(seriesArg(args[0], ctx, vars, depth), seriesArg(args[1], ctx, vars, depth));
    case 'RSI':
      return ind.rsi(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'DIF':
      return ind.dif(seriesArg(args[0], ctx, vars, depth), args[1].value, args[2].value);
    case 'DEA':
      return ind.dea(seriesArg(args[0], ctx, vars, depth), args[1].value, args[2].value, args[3].value);
    case 'MACD_HIST':
      return ind.macdHist(seriesArg(args[0], ctx, vars, depth), args[1].value, args[2].value, args[3].value);
    case 'KDJ_K':
    case 'KDJ_D': {
      const high = seriesArg(args[0], ctx, vars, depth);
      const low = seriesArg(args[1], ctx, vars, depth);
      const close = seriesArg(args[2], ctx, vars, depth);
      const result = ind.kdj(high, low, close, args[3].value, args[4].value, args[5].value);
      return name === 'KDJ_K' ? result.k : result.d;
    }
    case 'BOLL_MID':
      return ind.bollMid(seriesArg(args[0], ctx, vars, depth), args[1].value);
    case 'BOLL_UPPER':
      return ind.bollUpper(seriesArg(args[0], ctx, vars, depth), args[1].value, args[2].value);
    case 'BOLL_LOWER':
      return ind.bollLower(seriesArg(args[0], ctx, vars, depth), args[1].value, args[2].value);
    case 'TD_BUY':
      return ind.tdBuy(seriesArg(args[0], ctx, vars, depth));
    case 'TD_SELL':
      return ind.tdSell(seriesArg(args[0], ctx, vars, depth));
    default:
      throw new Error('未知函数「' + name + '」');
  }
}

function evaluateFormula(info, ctx) {
  const vars = new Map();
  for (const stmt of info.executable) {
    const value = evalNode(stmt.expr, ctx, vars, 0);
    if (stmt.type === 'assign') vars.set(stmt.name, value);
  }
  const result = evalNode(info.resultExpr, ctx, vars, 0);
  return asSeries(result, ctx.n);
}

function buildContext(bars) {
  const n = bars.length;
  function make(getter) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const value = getter(bars[i], i);
      out[i] = Number.isFinite(value) ? value : NaN;
    }
    return out;
  }
  const close = make((bar) => bar.close);
  const vol = make((bar) => bar.volume);
  return {
    n,
    series: {
      CLOSE: close,
      OPEN: make((bar) => bar.open),
      HIGH: make((bar) => bar.high),
      LOW: make((bar) => bar.low),
      VOL: vol,
      VOLUME: vol,
      AMOUNT: make((bar) => bar.amount),
    },
  };
}

// =====================================================================
// 五、回测引擎
// =====================================================================

async function loadBars(code, assetType) {
  if (assetType === 'fund') {
    const detail = await getFundInternal(code);
    const fund = detail && detail.value;
    if (!fund || !Array.isArray(fund.navSeries) || fund.navSeries.length < 2) {
      throw new Error('基金历史净值不足：' + code);
    }
    const bars = fund.navSeries.map((point) => ({
      t: point.t,
      date: formatDate(point.t),
      open: point.nav,
      high: point.nav,
      low: point.nav,
      close: point.nav,
      volume: null,
      amount: null,
    }));
    return { bars, name: fund.name || code, historyType: 'nav', secid: null };
  }

  const series = await stocks.getStockSeries(code);
  const bars = series.points.map((point) => ({
    t: point.t,
    date: point.date || formatDate(point.t),
    open: Number.isFinite(point.open) ? point.open : point.nav,
    high: Number.isFinite(point.high) ? point.high : point.nav,
    low: Number.isFinite(point.low) ? point.low : point.nav,
    close: Number.isFinite(point.close) ? point.close : point.nav,
    volume: Number.isFinite(point.volume) ? point.volume : null,
    amount: Number.isFinite(point.amount) ? point.amount : null,
  }));
  return {
    bars,
    name: series.name || code,
    historyType: 'kline',
    secid: series.secid,
  };
}

async function loadBenchmark(startTs, endTs) {
  try {
    const kline = await stocks.getKline('1.000300');
    const points = kline.points.filter((point) => point.t >= startTs && point.t <= endTs);
    if (points.length < 2) return { series: [], returnPct: null };
    const base = points[0].nav;
    if (!(base > 0)) return { series: [], returnPct: null };
    const series = points.map((point) => ({ t: point.t, v: round(point.nav / base, 6) }));
    return { series, returnPct: round((series[series.length - 1].v - 1) * 100, 2) };
  } catch (err) {
    return { series: [], returnPct: null };
  }
}

function drawdownOf(series) {
  let peak = null;
  const out = [];
  let maxDrawdown = 0;
  for (const point of series) {
    if (peak === null || point.v > peak) peak = point.v;
    const dd = round((point.v / peak - 1) * 100, 2);
    if (dd < maxDrawdown) maxDrawdown = dd;
    out.push({ t: point.t, v: dd });
  }
  return { series: out, maxDrawdown: round(maxDrawdown, 2) };
}

/**
 * GET /api/strategy/backtest
 */
async function strategyBacktest(params) {
  const input = params || {};
  const code = String(input.code === null || input.code === undefined ? '' : input.code).trim();
  if (!code) throw new Error('缺少 code 参数');
  const assetType = String(input.assetType || 'stock').toLowerCase() === 'fund' ? 'fund' : 'stock';
  const buySource = String(input.buy === null || input.buy === undefined ? '' : input.buy).trim();
  const sellSource = String(input.sell === null || input.sell === undefined ? '' : input.sell).trim();
  if (!buySource || !sellSource) throw new Error('请同时提供买入（buy）与卖出（sell）公式');

  const years = clamp(Number.parseInt(input.years, 10) || 3, 1, 20);
  const startTsParsed = parseDate(input.start);
  const endTsParsed = parseDate(input.end);
  const capital = clamp(num(input.capital) || 100000, 100, 1e12);
  const feeRaw = input.fee === null || input.fee === undefined || input.fee === '' ? 0.0005 : num(input.fee);
  const fee = clamp(feeRaw === null ? 0.0005 : feeRaw, 0, 0.05);
  const stopLossRaw = num(input.stopLoss);
  const takeProfitRaw = num(input.takeProfit);
  const stopLoss = stopLossRaw !== null && stopLossRaw > 0 ? stopLossRaw : null;
  const takeProfit = takeProfitRaw !== null && takeProfitRaw > 0 ? takeProfitRaw : null;

  // 1) 先校验公式（快速失败；基金无成交量直接报错）
  const buyInfo = analyzeFormula(buySource, 'buy');
  const sellInfo = analyzeFormula(sellSource, 'sell');
  if (assetType === 'fund' && (buyInfo.usesVolume || sellInfo.usesVolume)) {
    throw new Error('该标的无成交量数据，不能使用 VOL/AMOUNT 指标');
  }

  const cacheKey =
    'strategy:' +
    hashText(
      [
        code,
        assetType,
        buySource,
        sellSource,
        startTsParsed !== null ? 'start:' + startTsParsed : 'years:' + years,
        endTsParsed !== null ? 'end:' + endTsParsed : '',
        capital,
        fee,
        stopLoss,
        takeProfit,
      ].join('|')
    );

  const cached = await cache.wrap(cacheKey, TTL, async () => {
    // 2) 加载全量数据（指标在全量历史计算，防未来函数）
    const loaded = await loadBars(code, assetType);
    const bars = loaded.bars;
    if (bars.length < 10) throw new Error('历史数据不足（少于 10 根 K 线），无法回测');

    const lastBar = bars[bars.length - 1];
    let endTs = endTsParsed !== null ? Math.min(endTsParsed, lastBar.t) : lastBar.t;
    if (endTsParsed !== null && endTsParsed > lastBar.t) endTs = lastBar.t;
    let startTs = startTsParsed !== null ? startTsParsed : endTs - years * 365 * 86400000;
    let truncated = false;
    if (startTs < bars[0].t) {
      truncated = true;
      startTs = bars[0].t;
    }

    let startIndex = -1;
    for (let i = 0; i < bars.length; i += 1) {
      if (bars[i].t >= startTs) {
        startIndex = i;
        break;
      }
    }
    let endIndex = -1;
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      if (bars[i].t <= endTs) {
        endIndex = i;
        break;
      }
    }
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) {
      throw new Error('回测区间内数据不足（至少需要 3 根 K 线），请调整起始日期或年限');
    }

    const ctx = buildContext(bars);
    const buySeries = evaluateFormula(buyInfo, ctx);
    const sellSeries = evaluateFormula(sellInfo, ctx);

    const isTrigger = (series, i) => Number.isFinite(series[i]) && series[i] !== 0;

    // 3) 逐日模拟
    const feeRate = fee;
    let cash = capital;
    let shares = 0;
    let entryPrice = null;
    let entryT = null;
    let entryDate = null;
    let entryCost = 0;
    let pending = null;
    const equity = [];
    const trades = [];
    const markers = [];
    let holdingDays = 0;
    let lastSignal = null;
    let lastSignalDate = null;
    let lastBuyValue = null;
    let lastSellValue = null;

    function doBuy(price, bar) {
      if (!(price > 0) || !(cash > 0) || shares > 0) return;
      shares = cash / (price * (1 + feeRate));
      entryCost = cash;
      cash = 0;
      entryPrice = price;
      entryT = bar.t;
      entryDate = bar.date;
      markers.push({ t: bar.t, type: 'buy', price: round(price, 4) });
    }

    function doSell(price, bar, reason) {
      if (!(shares > 0)) return;
      const safePrice = price > 0 ? price : bar.close;
      const proceeds = shares * safePrice * (1 - feeRate);
      cash = proceeds;
      const profit = proceeds - entryCost;
      const profitPct = entryCost > 0 ? (profit / entryCost) * 100 : null;
      const holdDays = entryT !== null ? Math.max(0, Math.round((bar.t - entryT) / 86400000)) : 0;
      trades.push({
        id: trades.length + 1,
        buyDate: entryDate,
        buyPrice: round(entryPrice, 4),
        sellDate: bar.date,
        sellPrice: round(safePrice, 4),
        shares: round(shares, 4),
        profit: round(profit, 2),
        profitPct: round(profitPct, 2),
        holdDays,
        reason,
      });
      markers.push({ t: bar.t, type: 'sell', price: round(safePrice, 4) });
      shares = 0;
      entryPrice = null;
      entryT = null;
      entryDate = null;
      entryCost = 0;
    }

    for (let i = startIndex; i <= endIndex; i += 1) {
      const bar = bars[i];

      // 3.1 上一根信号：本根开盘成交
      if (pending === 'buy' && shares === 0) {
        doBuy(bar.open > 0 ? bar.open : bar.close, bar);
      } else if (pending === 'sell' && shares > 0) {
        doSell(bar.open > 0 ? bar.open : bar.close, bar, 'signal');
      }
      pending = null;

      // 3.2 止损 / 止盈（止损优先，保守口径）
      if (shares > 0 && entryPrice !== null) {
        const stopPrice = stopLoss !== null ? entryPrice * (1 - stopLoss / 100) : null;
        const takePrice = takeProfit !== null ? entryPrice * (1 + takeProfit / 100) : null;
        if (stopPrice !== null && Number.isFinite(bar.low) && bar.low <= stopPrice) {
          doSell(stopPrice, bar, 'stopLoss');
        } else if (takePrice !== null && Number.isFinite(bar.high) && bar.high >= takePrice) {
          doSell(takePrice, bar, 'takeProfit');
        }
      }

      // 3.3 本根信号 → 下一根开盘执行
      if (i < endIndex) {
        if (shares > 0 && isTrigger(sellSeries, i)) pending = 'sell';
        else if (shares === 0 && isTrigger(buySeries, i)) pending = 'buy';
      }

      // 3.4 记录最后信号（含回测区间最后一根）
      if (isTrigger(buySeries, i)) {
        lastSignal = 'buy';
        lastSignalDate = bar.date;
        lastBuyValue = round(buySeries[i], 4);
      }
      if (isTrigger(sellSeries, i)) {
        lastSignal = 'sell';
        lastSignalDate = bar.date;
        lastSellValue = round(sellSeries[i], 4);
      }

      // 3.5 每日权益（收盘价计）
      equity.push({ t: bar.t, v: cash + shares * bar.close });
      if (shares > 0) holdingDays += 1;
    }

    // 3.6 记录「当前」状态（末根强制平仓前的持仓/信号，供前端展示策略当前状态）
    const currentState = {
      holding: shares > 0,
      entryDate: entryDate,
      entryPrice: entryPrice === null ? null : round(entryPrice, 4),
      shares: round(shares, 4),
      lastSignalDate,
      lastSignal,
      buyValue: lastBuyValue,
      sellValue: lastSellValue,
    };

    // 3.7 最后一根强制平仓（收盘价，reason=end）
    if (shares > 0) {
      const lastIndex = endIndex;
      const bar = bars[lastIndex];
      doSell(bar.close > 0 ? bar.close : bar.open, bar, 'end');
      equity[equity.length - 1] = { t: bar.t, v: cash };
    }

    // 4) 曲线与指标
    const curveFull = equity.map((point) => ({ t: point.t, v: round(point.v / capital, 6) }));
    const returns = [];
    for (let i = 1; i < curveFull.length; i += 1) {
      const r = curveFull[i].v / curveFull[i - 1].v - 1;
      if (Number.isFinite(r) && Math.abs(r) < 1) returns.push(r);
    }
    const totalReturn = round((curveFull[curveFull.length - 1].v - 1) * 100, 2);
    const days = (curveFull[curveFull.length - 1].t - curveFull[0].t) / 86400000;
    const annualized =
      days > 0 ? round((Math.pow(curveFull[curveFull.length - 1].v, 365 / days) - 1) * 100, 2) : null;

    const ddResult = drawdownOf(curveFull);

    let volatility = null;
    if (returns.length > 1) {
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
      volatility = round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
    }
    const sharpe = volatility && annualized !== null ? round((annualized - 1.5) / volatility, 2) : null;

    const tradeCount = trades.length;
    const wins = trades.filter((trade) => trade.profit > 0).length;
    const winRate = tradeCount ? round((wins / tradeCount) * 100, 2) : 0;
    const avgHoldDays = tradeCount
      ? round(trades.reduce((sum, trade) => sum + trade.holdDays, 0) / tradeCount, 1)
      : 0;
    const totalBars = endIndex - startIndex + 1;
    const exposure = totalBars > 0 ? round((holdingDays / totalBars) * 100, 2) : 0;

    let grossProfit = 0;
    let grossLoss = 0;
    for (const trade of trades) {
      if (trade.profit > 0) grossProfit += trade.profit;
      else grossLoss += -trade.profit;
    }
    const profitFactor =
      grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? null : 0;

    // 5) 基准
    const benchmark = await loadBenchmark(curveFull[0].t, curveFull[curveFull.length - 1].t);

    // 6) 说明
    const noteParts = [
      (loaded.historyType === 'kline' ? '股票/ETF 使用东财后复权日线（fqt=2）' : '基金使用单位净值序列'),
      '区间 ' + bars[startIndex].date + ' ~ ' + bars[endIndex].date,
      'T 日信号于 T+1 开盘成交',
      '单边费率 ' + (fee * 100).toFixed(3) + '%',
    ];
    if (stopLoss !== null) noteParts.push('止损 ' + stopLoss + '%');
    if (takeProfit !== null) noteParts.push('止盈 ' + takeProfit + '%');
    if (truncated) noteParts.push('起始日期早于历史数据起点，已自动截断至 ' + bars[0].date);
    noteParts.push('最后一根 K 线强制平仓');

    return {
      code,
      name: loaded.name,
      assetType,
      startDate: bars[startIndex].date,
      endDate: bars[endIndex].date,
      capital: round(capital, 2),
      fee,
      stopLoss,
      takeProfit,
      buyFormula: buySource,
      sellFormula: sellSource,
      curve: downsample(curveFull, 240),
      benchmark: downsample(benchmark.series, 240),
      drawdown: downsample(ddResult.series, 240),
      metrics: {
        totalReturn,
        annualized,
        maxDrawdown: ddResult.maxDrawdown,
        volatility,
        sharpe,
        benchmarkReturn: benchmark.returnPct,
        tradeCount,
        winRate,
        avgHoldDays,
        exposure,
        profitFactor,
      },
      trades,
      markers,
      current: currentState,
      note: noteParts.join('；') + '。',
    };
  });

  return { ok: true, result: Object.assign({}, cached.value, { source: cached.source }), source: cached.source };
}

// =====================================================================
// 六、模板
// =====================================================================

const TEMPLATES = [
  {
    key: 'ma-cross',
    name: '均线金叉死叉',
    desc: '5 日线上穿 20 日线买入，下穿卖出，经典趋势跟随。',
    icon: '📈',
    badge: '趋势',
    code: '600519',
    codeName: '贵州茅台',
    assetType: 'stock',
    buy: 'CROSS(MA(CLOSE,5),MA(CLOSE,20))',
    sell: 'CROSSDOWN(MA(CLOSE,5),MA(CLOSE,20))',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
  {
    key: 'macd-cross',
    name: 'MACD 金叉',
    desc: 'DIF 上穿 DEA 买入，下穿卖出，中期动量确认。',
    icon: '📊',
    badge: '动量',
    code: '600519',
    codeName: '贵州茅台',
    assetType: 'stock',
    buy: 'CROSS(DIF(CLOSE,12,26),DEA(CLOSE,12,26,9))',
    sell: 'CROSSDOWN(DIF(CLOSE,12,26),DEA(CLOSE,12,26,9))',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
  {
    key: 'td-nine',
    name: '神奇九转',
    desc: '连续 9 日收盘低于 4 日前收盘买入，连续 9 日高于买入反向卖出。',
    icon: '🔮',
    badge: '择时',
    code: '600519',
    codeName: '贵州茅台',
    assetType: 'stock',
    buy: 'TD_BUY(CLOSE)==9',
    sell: 'TD_SELL(CLOSE)==9',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
  {
    key: 'volume-price',
    name: '量价齐升',
    desc: '站上 20 日线且放量 1.5 倍买入，跌破 20 日线卖出。',
    icon: '📦',
    badge: '量价',
    code: '510300',
    codeName: '沪深300ETF',
    assetType: 'stock',
    buy: 'CLOSE>MA(CLOSE,20) AND VOL>MA(VOL,5)*1.5',
    sell: 'CLOSE<MA(CLOSE,20)',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
  {
    key: 'ma-bull',
    name: '均线多头',
    desc: '5/10/20 日线多头排列买入，5 日线跌破 10 日线卖出。',
    icon: '🐂',
    badge: '趋势',
    code: '510300',
    codeName: '沪深300ETF',
    assetType: 'stock',
    buy: 'MA(CLOSE,5)>MA(CLOSE,10) AND MA(CLOSE,10)>MA(CLOSE,20)',
    sell: 'MA(CLOSE,5)<MA(CLOSE,10)',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
  {
    key: 'rsi-rebound',
    name: 'RSI 超卖反弹',
    desc: 'RSI(14) 跌破 30 买入，回到 70 以上卖出。',
    icon: '🧭',
    badge: '反转',
    code: '600519',
    codeName: '贵州茅台',
    assetType: 'stock',
    buy: 'RSI(CLOSE,14)<30',
    sell: 'RSI(CLOSE,14)>70',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
  {
    key: 'boll-break',
    name: '布林突破',
    desc: '收盘上穿布林上轨买入，下穿中轨卖出。',
    icon: '🎯',
    badge: '突破',
    code: '600519',
    codeName: '贵州茅台',
    assetType: 'stock',
    buy: 'CROSS(CLOSE,BOLL_UPPER(CLOSE,20,2))',
    sell: 'CROSSDOWN(CLOSE,BOLL_MID(CLOSE,20))',
    params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
  },
];

function getTemplates() {
  return { ok: true, items: TEMPLATES.map((item) => JSON.parse(JSON.stringify(item))) };
}

module.exports = {
  TTL,
  tokenize,
  parseSource,
  analyzeFormula,
  validateFormulas,
  evaluateFormula,
  buildContext,
  strategyBacktest,
  getTemplates,
  TEMPLATES,
  // 调试/测试
  _ind: ind,
  _parseDate: parseDate,
};
