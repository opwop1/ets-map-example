#!/usr/bin/env node
/**
 * ts-map 导出数据 → map_marker 导入 SQL 生成器
 *
 * 用法:
 *   node gen-marker-sql.js --dir <导出目录> --mapType <map_type> --base <资源根URL>
 *
 * 示例 (tmp-ets):
 *   node gen-marker-sql.js --dir "f:/code/ets-map-example-main/瓦片-用/tmp-ets" --mapType 3 --base https://ets_tiles.cnly.top/tmp-ets
 *
 * 示例 (tmp-promods):
 *   node gen-marker-sql.js --dir "f:/code/ets-map-example-main/瓦片-用/tmp-promods" --mapType 2 --base https://ets_tiles.cnly.top/tmp-promods
 *
 * 输入: 目录下的 Countries.json / Cities.json / Overlays.json (Countries.json 可缺省,
 *        缺省时国家坐标由该国城市坐标均值生成)
 * 输出: 目录下 map_marker.sql (UTF-8 无 BOM, 开头 DELETE 可重复执行)
 */
const fs = require('fs');
const path = require('path');

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];

const dir = opt.dir;
const mapType = parseInt(opt.mapType, 10);
const base = (opt.base || '').replace(/\/+$/, '');

if (!dir || !mapType || !base) {
    console.error('缺少参数. 用法: node gen-marker-sql.js --dir <导出目录> --mapType <数字> --base <资源根URL>');
    process.exit(1);
}

// ---------- 类型映射 (Overlays.json Type -> map_marker.type, 见 GameConstant.MapMarkerTypeEnum) ----------
const OVERLAY_TYPE_MAP = {
    'Company': 3,
    'TruckDealer': 4,
    'Parking': 5,
    'Service': 6,
    'Recruitment': 7,
    'Ferry': 8,
    'Garage': 9,
    'Fuel': 10,
    'Train': 11,
    'Viewpoint': 12,
    'WeightStation': 13,
    'Bus Stop': 14,
    'Overlay': 99,
};

// ---------- 国家名 -> ISO 3166-1 alpha-2 (小写), 用于拼接 flags/{iso}.svg ----------
// key 统一小写; 含中文/英文/游戏内名称
const COUNTRY_ISO = {
    // 中文
    '阿尔巴尼亚': 'al', '阿塞拜疆': 'az', '埃及': 'eg', '爱尔兰': 'ie', '爱沙尼亚': 'ee',
    '安道尔': 'ad', '奥地利': 'at', '奥兰群岛': 'ax', '白俄罗斯': 'by', '保加利亚': 'bg',
    '北爱尔兰': 'gb', '北马其顿': 'mk', '比利时': 'be', '冰岛': 'is', '波兰': 'pl',
    '波斯尼亚和黑塞哥维那': 'ba', '丹麦': 'dk', '德国': 'de', '俄罗斯': 'ru', '法国': 'fr',
    '法罗群岛': 'fo', '芬兰': 'fi', '格陵兰': 'gl', '格鲁吉亚': 'ge', '根西岛': 'gg',
    '哈萨克斯坦': 'kz', '荷兰': 'nl', '黑山': 'me', '捷克': 'cz', '捷克共和国': 'cz',
    '科索沃': 'xk', '克罗地亚': 'hr', '拉脱维亚': 'lv', '黎巴嫩': 'lb', '立陶宛': 'lt',
    '卢森堡': 'lu', '罗马尼亚': 'ro', '马恩岛': 'im', '马耳他': 'mt', '摩尔多瓦': 'md',
    '摩洛哥': 'ma', '摩纳哥': 'mc', '挪威': 'no', '葡萄牙': 'pt', '瑞典': 'se', '瑞士': 'ch',
    '塞尔维亚': 'rs', '塞浦路斯': 'cy', '沙特阿拉伯': 'sa', '斯洛伐克': 'sk',
    '斯洛文尼亚': 'si', '斯瓦尔巴': 'no', '突尼斯': 'tn', '土耳其': 'tr',
    '土库曼斯坦': 'tm', '乌克兰': 'ua', '乌兹别克斯坦': 'uz', '西班牙': 'es', '希腊': 'gr',
    '匈牙利': 'hu', '叙利亚': 'sy', '亚美尼亚': 'am', '伊拉克': 'iq', '以色列': 'il',
    '意大利': 'it', '英国': 'gb', '约旦': 'jo', '约旦河西岸': 'ps', '泽西岛': 'je',
    '直布罗陀': 'gi', '伊朗': 'ir',
    // 英文/游戏原名
    'aland': 'ax', 'azerbaycan': 'az', 'guernsey': 'gg', 'hayastan': 'am',
    'isle of man': 'im', 'jersey': 'je', 'kalaallit nunaat': 'gl', 'svalbard': 'no',
    'england': 'gb', 'scotland': 'gb', 'wales': 'gb', 'great britain': 'gb',
    'united kingdom': 'gb', 'czech republic': 'cz', 'bosnia and herzegovina': 'ba',
    'macedonia': 'mk', 'holland': 'nl', 'saudi arabia': 'sa', 'united states': 'us',
    'svalbard and jan mayen': 'no', 'west bank': 'ps', 'united arab emirates': 'ae',
    'qatar': 'qa', 'kuwait': 'kw', 'bahrain': 'bh', 'oman': 'om', 'yemen': 'ye',
    'armenia': 'am', 'georgia': 'ge', 'turkmenistan': 'tm', 'uzbekistan': 'uz',
    'kazakhstan': 'kz', 'kyrgyzstan': 'kg', 'tajikistan': 'tj', 'afghanistan': 'af',
    'pakistan': 'pk', 'iran': 'ir', 'iraq': 'iq', 'israel': 'il', 'jordan': 'jo',
    'lebanon': 'lb', 'syria': 'sy', 'egypt': 'eg', 'morocco': 'ma', 'tunisia': 'tn',
    'algeria': 'dz', 'libya': 'ly', 'gibraltar': 'gi', 'malta': 'mt', 'cyprus': 'cy',
    'monaco': 'mc', 'andorra': 'ad', 'liechtenstein': 'li', 'san marino': 'sm',
    'vatican': 'va', 'luxembourg': 'lu', 'belgium': 'be', 'netherlands': 'nl',
    'germany': 'de', 'austria': 'at', 'switzerland': 'ch', 'italaly': 'it',
    'italy': 'it', 'france': 'fr', 'spain': 'es', 'portugal': 'pt', 'ireland': 'ie',
    'iceland': 'is', 'norway': 'no', 'sweden': 'se', 'finland': 'fi', 'denmark': 'dk',
    'estonia': 'ee', 'latvia': 'lv', 'lithuania': 'lt', 'poland': 'pl', 'czechia': 'cz',
    'slovakia': 'sk', 'hungary': 'hu', 'slovenia': 'si', 'croatia': 'hr', 'serbia': 'rs',
    'montenegro': 'me', 'albania': 'al', 'kosovo': 'xk', 'bulgaria': 'bg',
    'romania': 'ro', 'moldova': 'md', 'ukraine': 'ua', 'belarus': 'by', 'russia': 'ru',
    'greece': 'gr', 'turkey': 'tr', 'faroe islands': 'fo', 'greenland': 'gl',
    // 游戏内别名/非标准写法
    '西岸': 'ps', '阿美尼亚': 'am', '斯瓦尔巴群岛': 'no', 'sakartvelo': 'ge', 'საქართველი': 'ge', 'საქართველო': 'ge',
};

// ---------- 工具 ----------
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
// 名称选择: zh_cn > zh_tw > 原名
const pickName = (item) => {
    const loc = item.LocalizedNames || {};
    return loc.zh_cn || loc.zh_tw || item.Name || null;
};
// Unicode 归一化: 去变音符号 + 小写 (Åland -> aland)
const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const resolveIso = (name) => {
    if (!name) return null;
    return COUNTRY_ISO[normalize(name)] || COUNTRY_ISO[name] || null;
};

const readJson = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

// ---------- 读取数据 ----------
const countries = readJson('Countries.json');
const cities = readJson('Cities.json');
const overlays = readJson('Overlays.json');

if (!cities) {
    console.error(`未找到 ${path.join(dir, 'Cities.json')}`);
    process.exit(1);
}

// ---------- id 段: 国家 3000...{mapType}..., 城市/覆盖点 4000...{mapType}... ----------
const countryIdBase = 3000000000000000000n + BigInt(mapType) * 1000000000n;
const pointIdBase = 4000000000000000000n + BigInt(mapType) * 1000000000n;

const rows = []; // {id, parentId, name, type, x, y, iconUrl}
const warnings = [];

// ---------- 国家 ----------
let countryList = [];
if (countries) {
    countryList = countries.map((c) => ({
        countryId: c.CountryId,
        name: pickName(c),
        x: c.X, y: c.Y,
        country: c.Country || null,
    }));
} else {
    // 无 Countries.json: 按 CountryId 分组取城市坐标均值, 国家名取城市 Country 字段
    const groups = new Map();
    for (const city of cities) {
        const key = city.CountryId;
        if (!groups.has(key)) groups.set(key, { xs: [], ys: [], name: null });
        const g = groups.get(key);
        g.xs.push(city.X); g.ys.push(city.Y);
        if (!g.name && city.Country) g.name = city.Country;
    }
    for (const [countryId, g] of groups) {
        const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
        countryList.push({ countryId, name: g.name, x: avg(g.xs), y: avg(g.ys), country: g.name });
    }
}

const countryIdMap = new Map(); // 游戏CountryId -> 数据库id
let seq = 0n;
for (const c of countryList) {
    const id = countryIdBase + ++seq;
    countryIdMap.set(c.countryId, id);
    const iso = resolveIso(c.name);
    if (!iso) warnings.push(`国家 "${c.name}" 无 ISO 映射, icon_url 为 NULL`);
    rows.push({
        id, parentId: 0, name: c.name, type: 1, x: c.x, y: c.y,
        iconUrl: iso ? `${base}/flags/${iso}.svg` : null,
    });
}

// ---------- 城市 ----------
for (const city of cities) {
    rows.push({
        id: null, // 稍后统一编号
        parentId: countryIdMap.get(city.CountryId) || 0,
        name: pickName(city),
        type: 2, x: city.X, y: city.Y,
        iconUrl: null,
    });
}

// ---------- 覆盖点 ----------
if (overlays) {
    for (const o of overlays) {
        const type = OVERLAY_TYPE_MAP[o.Type];
        if (!type) {
            warnings.push(`覆盖点 "${o.Name}" 类型 "${o.Type}" 未映射, 已跳过`);
            continue;
        }
        rows.push({
            id: null,
            parentId: 0,
            name: o.Type, // 覆盖点无名称, 用类型名
            type, x: o.X, y: o.Y,
            iconUrl: `${base}/Overlays/${o.Name}.png`,
        });
    }
}

// 城市/覆盖点统一编号
let pSeq = 0n;
for (const r of rows) {
    if (r.id === null) r.id = pointIdBase + ++pSeq;
}

// ---------- 生成 SQL ----------
const CHUNK = 500;
const lines = [];
lines.push(`-- 由 gen-marker-sql.js 自动生成, 来源: ts-map 导出目录 ${dir}`);
lines.push(`-- map_type=${mapType}, 资源根: ${base}`);
lines.push(`-- 共 ${rows.length} 条 (国家${countryList.length} / 城市${cities.length} / 覆盖点${overlays ? overlays.length : 0})`);
lines.push(`DELETE FROM \`map_marker\` WHERE \`map_type\` = ${mapType};`);
lines.push('');

for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    lines.push('INSERT INTO `map_marker` (`id`, `parent_id`, `name`, `map_type`, `type`, `axis_x`, `axis_y`, `icon_url`) VALUES');
    const values = chunk.map((r) =>
        `(${r.id}, ${r.parentId}, '${esc(r.name)}', ${mapType}, ${r.type}, ${r.x}, ${r.y}, ${r.iconUrl === null ? 'NULL' : `'${r.iconUrl}'`})`
    );
    lines.push(values.join(',\n') + ';');
    lines.push('');
}

const outPath = path.join(dir, 'map_marker.sql');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

console.log(`已生成: ${outPath}`);
console.log(`共 ${rows.length} 条: 国家 ${countryList.length}, 城市 ${cities.length}, 覆盖点 ${overlays ? overlays.length : 0}`);
if (warnings.length) {
    console.log(`\n警告 ${warnings.length} 条:`);
    warnings.slice(0, 20).forEach((w) => console.log('  - ' + w));
    if (warnings.length > 20) console.log(`  ... 及其余 ${warnings.length - 20} 条`);
}
