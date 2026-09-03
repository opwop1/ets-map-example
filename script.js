// ============ 地图类型配置 ============
// 1: 原版 ETS2  2: ProMods(临时导出)  3: 新版 ETS2(临时导出)
// promods 坐标系来自 tmp-promods/TileMapInfo.json, factor = tileSize / 地图宽度
const promodsMapInfo = {
    minX: -135110.156,
    minY: -197653.719,
    maxX: 205684.1,
    maxY: 143140.531,
    mapWidth: 340794.256,
    mapHeight: 340794.25,
    factorX: 512 / 340794.256,
    factorY: 512 / 340794.25,
    minZoom: 2,
    maxZoom: 8,
    tileSize: 512
};

const MAP_TYPES = {
    1: {
        name: '原版 ETS2',
        mapConfig: () => mapinfo.ets,
        tileUrl: 'https://ets-map.oss-cn-beijing.aliyuncs.com/tiles/ets/{z}/{x}/{y}.png',
        supportsYellow: false
    },
    2: {
        name: 'ProMods',
        mapConfig: () => promodsMapInfo,
        tileUrl: {
            white: 'https://ets_tiles.cnly.top/20260903/tmp-promods/Tiles/{z}/{x}/{y}.png',
            yellow: 'https://ets_tiles.cnly.top/20260903/tmp-promods-yellow/Tiles/{z}/{x}/{y}.png'
        },
        supportsYellow: true
    },
    3: {
        name: '新版 ETS2',
        mapConfig: () => mapinfo.ets,
        tileUrl: {
            white: 'https://ets_tiles.cnly.top/20260903/tmp-ets/Tiles/{z}/{x}/{y}.png',
            yellow: 'https://ets_tiles.cnly.top/20260903/tmp-ets-yellow/Tiles/{z}/{x}/{y}.png'
        },
        supportsYellow: true
    }
};

let currentMapType = null;
let currentTileColor = 'white'; // 'white' | 'yellow'
let map = null;
let tileLayer = null;
let pointMap = new Map();
let playerMarkers = [];

// 取当前地图在指定颜色下的瓦片地址
function getTileUrl(mapTypeId, color) {
    const conf = MAP_TYPES[mapTypeId];
    return typeof conf.tileUrl === 'string' ? conf.tileUrl : conf.tileUrl[color];
}

// ============ 切换路线颜色 ============
function toggleTileColor() {
    const conf = MAP_TYPES[currentMapType];
    if (!conf || !conf.supportsYellow || !tileLayer) return;
    currentTileColor = currentTileColor === 'yellow' ? 'white' : 'yellow';
    tileLayer.setUrl(getTileUrl(currentMapType, currentTileColor));
    updateColorBtn();
}

function updateColorBtn() {
    const btn = document.getElementById('colorSwitchBtn');
    if (!btn) return;
    const conf = MAP_TYPES[currentMapType];
    btn.style.display = conf && conf.supportsYellow ? '' : 'none';
    btn.classList.toggle('active', currentTileColor === 'yellow');
}

// ============ 切换地图 ============
function switchMapType(mapTypeId) {
    if (currentMapType === mapTypeId || !MAP_TYPES[mapTypeId]) return;
    currentMapType = mapTypeId;

    // 更新按钮激活状态
    document.querySelectorAll('.map-switch-btn').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.mapType) === mapTypeId);
    });

    // 销毁旧地图(其上的标点随之移除)
    if (map) {
        map.remove();
        map = null;
        tileLayer = null;
    }
    pointMap.clear();
    playerMarkers = [];

    // 原版 ETS2 无黄色瓦片, 切换过去时重置为白色
    if (!MAP_TYPES[mapTypeId].supportsYellow) currentTileColor = 'white';
    updateColorBtn();

    initMap(mapTypeId);
    loadMarkers(mapTypeId);
    loadPlayers();
    refreshPoint();
}

// ============ 初始化地图 ============
function initMap(mapTypeId) {
    const mapConfig = MAP_TYPES[mapTypeId].mapConfig();

    const crs = L.Util.extend({}, L.CRS.Simple, {
        transformation: new L.Transformation(
            mapConfig.factorX,
            -mapConfig.minX * mapConfig.factorX,
            mapConfig.factorY,
            -mapConfig.minY * mapConfig.factorY
        )
    });

    const bounds = [
        [mapConfig.minY, mapConfig.minX],
        [mapConfig.maxY, mapConfig.maxX]
    ];

    map = L.map('map', {
        crs: crs,
        minZoom: mapConfig.minZoom,
        maxZoom: mapConfig.maxZoom,
        zoomSnap: 0.5,
        wheelPxPerZoomLevel: 120,
        center: [0, 0],
        zoom: mapConfig.minZoom,
        maxBounds: bounds,
        maxBoundsViscosity: 0.8,
        attributionControl: false
    });

    // 重置标点显隐状态
    const mapEl = document.querySelector('#map');
    mapEl.style.setProperty('--country-opacity', '1');
    mapEl.style.setProperty('--city-opacity', '0');
    mapEl.style.setProperty('--point-opacity', '0');

    // 添加瓦片图层
    tileLayer = L.tileLayer(getTileUrl(mapTypeId, currentTileColor), {
        tileSize: mapConfig.tileSize,
        noWrap: true,
        bounds: bounds,
    }).addTo(map);

    // 鼠标位置坐标展示
    map.on('mousemove', _.throttle((e) => {
        document.querySelector('.axis-box').innerHTML = `x: ${e.latlng.lng.toFixed(2)} y: ${e.latlng.lat.toFixed(2)}`;
    }, 100));

    // 鼠标点击控制台打印坐标
    map.on('click', (e) => {
        console.log(`点击坐标 x: ${e.latlng.lng.toFixed(2)} y: ${e.latlng.lat.toFixed(2)}`);
    });

    // 地图移动结束打印矩形坐标
    map.on('moveend', function(e) {
        let bounds = map.getBounds();
        let minX = bounds.getWest();
        let minY = bounds.getSouth();
        let maxX = bounds.getEast();
        let maxY = bounds.getNorth();
        console.log(`地图移动结束 minX:${minX.toFixed(2)} minY:${minY.toFixed(2)} maxX:${maxX.toFixed(2)} maxY:${maxY.toFixed(2)}`);
        refreshPoint();
    });

    // 缩放级别变动
    map.on('zoomend', function() {
        const currentZoom = map.getZoom();
        console.log('zoom: ', currentZoom);
        refreshCountry(currentZoom);
        refreshCity(currentZoom);
        refreshPoint();
    });
}

// ============ 加载国家/城市标点 ============
function loadMarkers(mapTypeId) {
    // 设置国家标点
    axios.get(`https://evmapi.cxnnn.cn/map/marker?mapType=${mapTypeId}&type=1`).then(({data}) => {
        if (data.code === 200 && currentMapType === mapTypeId && map) {
            data.data.forEach(country => {
                let myCustomIcon = L.divIcon({
                    html: `
                        <div class="country-box">
                            <img class="flag" src="${country.iconUrl}"/>
                            <div class="name">${country.name}</div>
                        </div>
                    `,
                    className: 'leaflet-clean',
                    iconSize: null,
                    iconAnchor: [0, 0]
                });
                L.marker([country.axisY, country.axisX], { icon: myCustomIcon }).addTo(map);
            });
        }
    });

    // 设置城市标点
    axios.get(`https://evmapi.cxnnn.cn/map/marker?mapType=${mapTypeId}&type=2`).then(({data}) => {
        if (data.code === 200 && currentMapType === mapTypeId && map) {
            data.data.forEach(country => {
                let myCustomIcon = L.divIcon({
                    html: `<div class="city-box"><span>${country.name}</span></div>`,
                    className: 'leaflet-clean',
                    iconSize: null,
                    iconAnchor: [0, 0]
                });
                L.marker([country.axisY, country.axisX], { icon: myCustomIcon }).addTo(map);
            });
        }
    });
}

// 显示瓦片边框和编号
L.GridLayer.DebugCoords = L.GridLayer.extend({
    createTile: function (coords) {
        var tile = document.createElement('div');
        tile.innerHTML = `<span style="background-color: hsla(0, 0%, 0%, 80%);padding: 0 4px">x:${coords.x} y:${coords.y} s:${coords.z}</span>`;
        tile.style.outline = '1px solid hsla(0, 0%, 70%, 30%)';
        tile.style.color = 'hsl(0, 0%, 100%)';
        tile.style.fontSize = '14px';
        tile.style.fontWeight = 'bold';
        return tile;
    }
});
// map.addLayer(new L.GridLayer.DebugCoords());

const refreshCountry = (zoom) => {
    if (zoom >= 4) {
        document.querySelector('#map').style.setProperty('--country-opacity', '0')
    } else {
        document.querySelector('#map').style.setProperty('--country-opacity', '1')
    }
}

const refreshCity = (zoom) => {
    if (zoom >= 4) {
        document.querySelector('#map').style.setProperty('--city-opacity', '1')
    } else {
        document.querySelector('#map').style.setProperty('--city-opacity', '0')
    }
}

const refreshPoint = _.throttle(() => {
    if (!map) return;
    const zoom = map.getZoom();
    if (zoom >= 6) {
        document.querySelector('#map').style.setProperty('--point-opacity', '0')
        let minX = map.getBounds().getWest();
        let minY = map.getBounds().getSouth();
        let maxX = map.getBounds().getEast();
        let maxY = map.getBounds().getNorth();
        const width = maxX - minX;
        const height = maxY - minY;
        axios.get(`https://evmapi.cxnnn.cn/map/marker?mapType=${currentMapType}&aAxisX=${(minX - width * 0.5).toFixed(2)}&aAxisY=${(minY - height * 0.5).toFixed(2)}&bAxisX=${(maxX + width * 0.5).toFixed(2)}&bAxisY=${(maxY + height * 0.5).toFixed(2)}`).then(({data}) => {
            if (data.code === 200 && map) {
                data.data.forEach(point => {
                    // 跳过国家、城市和已存在的标点
                    if (point.type === 1 || point.type === 2 || pointMap.has(point.id)) {
                        return;
                    }

                    let html = '<div class="point-box">';
                    if (point.type === 3) {
                        html += `<img class="company" src="${point.iconUrl}" alt="${point.name}"/>`;
                    } else if ([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 99].includes(point.type)) {
                        html += `<img class="point" src="${point.iconUrl}" alt="point"/>`;
                    } else {
                        return;
                    }
                    html += `</div>`;

                    let myCustomIcon = L.divIcon({
                        html,
                        className: 'leaflet-clean',
                        iconSize: null,
                        iconAnchor: [0, 0]
                    });
                    let marker = L.marker([point.axisY, point.axisX], { icon: myCustomIcon }).addTo(map);
                    pointMap.set(point.id, marker);
                });
            }
        });
    } else {
        pointMap.forEach((val) => val.remove());
        pointMap.clear();
    }
    if (zoom >= 7) {
        document.querySelector('#map').style.setProperty('--point-opacity', '1')
    } else {
        document.querySelector('#map').style.setProperty('--point-opacity', '0')
    }
}, 200)

const urlParams = new URLSearchParams(window.location.search);
const tmpIdList = urlParams.get('tmpIdList');

const loadPlayers = () => {
    playerMarkers.forEach(m => m.remove());
    playerMarkers = [];
    if (!tmpIdList || !map) return;
    axios.get(`https://evmapi.cxnnn.cn/map/playerList?tmpIdList=${tmpIdList}`).then(({data}) => {
        if (data.code === 200 && map) {
            data.data.forEach(player => {
                let myCustomIcon = L.divIcon({
                    html: `
                        <div class="player-box">
                            <div class="player-dot"></div>
                            <div class="player-name">${player.tmpName}</div>
                        </div>
                    `,
                    className: 'leaflet-clean',
                    iconSize: null,
                    iconAnchor: [0, 0]
                });
                let marker = L.marker([player.axisY, player.axisX], { icon: myCustomIcon }).addTo(map);
                marker.on('click', () => {
                    const info = document.getElementById('playerInfo');
                    info.innerHTML = `<div class="player-info-row"><span class="player-info-label">TMP ID</span><span class="player-info-value">${player.tmpId}</span></div><div class="player-info-row"><span class="player-info-label">TMP 名称</span><span class="player-info-value">${player.tmpName}</span></div>`;
                    info.classList.add('active');
                });
                playerMarkers.push(marker);
            });
        }
    });
};
setInterval(() => { if (map) loadPlayers(); }, 20000);

// ============ 启动 ============
document.querySelectorAll('.map-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMapType(Number(btn.dataset.mapType)));
});
document.getElementById('colorSwitchBtn').addEventListener('click', toggleTileColor);

// 默认加载新版 ETS2
switchMapType(3);
