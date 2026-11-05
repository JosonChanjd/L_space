'use strict';

/**
 * 技术指标库（策略引擎底层，纯函数、零依赖）
 *
 * 约定：
 *   - 输入序列统一为等长数组（Float64Array / number[]），长度 n
 *   - 输出 Float64Array，长度 n；无效值为 NaN
 *   - 窗口内出现 NaN 时，依赖窗口的指标（MA/HHV/LLV/SUM/STD/RSI/KDJ/BOLL）输出 NaN
 *   - 全部指标因果（只依赖当前及历史数据），可安全用于防未来函数回测
 */

function toSeries(value, n) {
  if (value instanceof Float64Array) return value;
  if (Array.isArray(value)) return value;
  const out = new Float64Array(n);
  if (typeof value === 'number' && Number.isFinite(value)) out.fill(value);
  else out.fill(NaN);
  return out;
}

function sizeOf(series, fallback) {
  if (series && typeof series.length === 'number') return series.length;
  return fallback;
}

function fin(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---------------- 基础指标 ----------------

function ma(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  let sum = 0;
  let nanCount = 0;
  for (let i = 0; i < len; i += 1) {
    const v = x[i];
    if (fin(v)) sum += v;
    else nanCount += 1;
    if (i >= n) {
      const old = x[i - n];
      if (fin(old)) sum -= old;
      else nanCount -= 1;
    }
    if (i >= n - 1 && nanCount === 0) out[i] = sum / n;
  }
  return out;
}

function ema(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  const alpha = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < len; i += 1) {
    const v = x[i];
    if (!fin(v)) {
      out[i] = NaN;
      continue;
    }
    prev = fin(prev) ? alpha * v + (1 - alpha) * prev : v;
    out[i] = prev;
  }
  return out;
}

function ref(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  for (let i = n; i < len; i += 1) out[i] = x[i - n];
  return out;
}

function rollingExtreme(x, n, isMax) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  for (let i = 0; i < len; i += 1) {
    if (i < n - 1) continue;
    let best = isMax ? -Infinity : Infinity;
    let valid = true;
    for (let j = i - n + 1; j <= i; j += 1) {
      const v = x[j];
      if (!fin(v)) {
        valid = false;
        break;
      }
      if (isMax ? v > best : v < best) best = v;
    }
    if (valid) out[i] = best;
  }
  return out;
}

function hhv(x, n) {
  return rollingExtreme(x, n, true);
}

function llv(x, n) {
  return rollingExtreme(x, n, false);
}

function sum(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  for (let i = 0; i < len; i += 1) {
    if (i < n - 1) continue;
    let total = 0;
    let valid = true;
    for (let j = i - n + 1; j <= i; j += 1) {
      const v = x[j];
      if (!fin(v)) {
        valid = false;
        break;
      }
      total += v;
    }
    if (valid) out[i] = total;
  }
  return out;
}

function std(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  for (let i = 0; i < len; i += 1) {
    if (i < n - 1) continue;
    let total = 0;
    let valid = true;
    for (let j = i - n + 1; j <= i; j += 1) {
      const v = x[j];
      if (!fin(v)) {
        valid = false;
        break;
      }
      total += v;
    }
    if (!valid) continue;
    const mean = total / n;
    let acc = 0;
    for (let j = i - n + 1; j <= i; j += 1) acc += (x[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / n);
  }
  return out;
}

function abs(x, n) {
  const len = sizeOf(x, n);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i += 1) out[i] = fin(x[i]) ? Math.abs(x[i]) : NaN;
  return out;
}

function map2(a, b, fn) {
  const len = Math.max(a.length, b.length);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    out[i] = fin(x) && fin(y) ? fn(x, y) : NaN;
  }
  return out;
}

function max2(a, b) {
  return map2(a, b, (x, y) => (x > y ? x : y));
}

function min2(a, b) {
  return map2(a, b, (x, y) => (x < y ? x : y));
}

function cross(a, b) {
  const len = Math.max(a.length, b.length);
  const out = new Float64Array(len);
  for (let i = 1; i < len; i += 1) {
    if (fin(a[i - 1]) && fin(b[i - 1]) && fin(a[i]) && fin(b[i]) && a[i - 1] <= b[i - 1] && a[i] > b[i]) {
      out[i] = 1;
    }
  }
  return out;
}

function crossdown(a, b) {
  const len = Math.max(a.length, b.length);
  const out = new Float64Array(len);
  for (let i = 1; i < len; i += 1) {
    if (fin(a[i - 1]) && fin(b[i - 1]) && fin(a[i]) && fin(b[i]) && a[i - 1] >= b[i - 1] && a[i] < b[i]) {
      out[i] = 1;
    }
  }
  return out;
}

// ---------------- RSI（Wilder 平滑） ----------------

function rsi(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  if (len <= n) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i += 1) {
    if (!fin(x[i]) || !fin(x[i - 1])) return out;
    const diff = x[i] - x[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= n;
  avgLoss /= n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = n + 1; i < len; i += 1) {
    if (!fin(x[i]) || !fin(x[i - 1])) continue;
    const diff = x[i] - x[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (n - 1) + gain) / n;
    avgLoss = (avgLoss * (n - 1) + loss) / n;
    if (avgLoss === 0) out[i] = avgGain === 0 ? 50 : 100;
    else if (avgGain === 0) out[i] = 0;
    else out[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ---------------- MACD ----------------

function dif(x, short, long) {
  const fast = ema(x, short);
  const slow = ema(x, long);
  const len = Math.max(fast.length, slow.length);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = fin(fast[i]) && fin(slow[i]) ? fast[i] - slow[i] : NaN;
  }
  return out;
}

function dea(x, short, long, mid) {
  const d = dif(x, short, long);
  return ema(d, mid);
}

function macdHist(x, short, long, mid) {
  const d = dif(x, short, long);
  const e = ema(d, mid);
  const len = Math.max(d.length, e.length);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = fin(d[i]) && fin(e[i]) ? 2 * (d[i] - e[i]) : NaN;
  }
  return out;
}

// ---------------- KDJ ----------------

function kdj(high, low, close, n, m1, m2) {
  const len = Math.max(high.length, low.length, close.length);
  const highest = hhv(high, n);
  const lowest = llv(low, n);
  const k = new Float64Array(len).fill(NaN);
  const d = new Float64Array(len).fill(NaN);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < len; i += 1) {
    if (!fin(highest[i]) || !fin(lowest[i]) || !fin(close[i])) continue;
    const range = highest[i] - lowest[i];
    const rsv = range > 0 ? ((close[i] - lowest[i]) / range) * 100 : 50;
    prevK = ((m1 - 1) * prevK + rsv) / m1;
    prevD = ((m2 - 1) * prevD + prevK) / m2;
    k[i] = prevK;
    d[i] = prevD;
  }
  return { k, d };
}

// ---------------- BOLL ----------------

function bollMid(x, n) {
  return ma(x, n);
}

function bollUpper(x, n, k) {
  const mid = ma(x, n);
  const sd = std(x, n);
  const len = Math.max(mid.length, sd.length);
  const out = new Float64Array(len).fill(NaN);
  for (let i = 0; i < len; i += 1) out[i] = fin(mid[i]) && fin(sd[i]) ? mid[i] + k * sd[i] : NaN;
  return out;
}

function bollLower(x, n, k) {
  const mid = ma(x, n);
  const sd = std(x, n);
  const len = Math.max(mid.length, sd.length);
  const out = new Float64Array(len).fill(NaN);
  for (let i = 0; i < len; i += 1) out[i] = fin(mid[i]) && fin(sd[i]) ? mid[i] - k * sd[i] : NaN;
  return out;
}

// ---------------- 神奇九转（TD 序列 1..9） ----------------

function tdSetup(x, isBuy) {
  const len = x.length;
  const out = new Float64Array(len); // 0 表示无计数
  let count = 0;
  for (let i = 0; i < len; i += 1) {
    if (i < 4 || !fin(x[i]) || !fin(x[i - 4])) {
      count = 0;
      continue;
    }
    const cond = isBuy ? x[i] < x[i - 4] : x[i] > x[i - 4];
    if (cond) count += 1;
    else count = 0;
    out[i] = count > 0 ? Math.min(count, 9) : 0;
  }
  return out;
}

function tdBuy(x) {
  return tdSetup(x, true);
}

function tdSell(x) {
  return tdSetup(x, false);
}

module.exports = {
  toSeries,
  ma,
  ema,
  ref,
  hhv,
  llv,
  sum,
  std,
  abs,
  max2,
  min2,
  cross,
  crossdown,
  rsi,
  dif,
  dea,
  macdHist,
  kdj,
  bollMid,
  bollUpper,
  bollLower,
  tdBuy,
  tdSell,
};
