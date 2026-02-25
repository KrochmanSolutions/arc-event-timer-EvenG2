import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

// Display constants
const CANVAS_WIDTH = 576;
const CANVAS_HEIGHT = 288;
const HEADER_HEIGHT = 50;
const LOGO_WIDTH = 200;
const LOGO_HEIGHT = 44;
const LIST_Y_OFFSET = HEADER_HEIGHT + 4;
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';
const REFRESH_INTERVAL = 60000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const MAX_LIST_ITEMS = 20;
const EVENTS_PER_PAGE = 7; // Fits on screen

// Screen types
type Screen = 'main' | 'favorites' | 'all-events' | 'settings' | 'settings-autolaunch' | 'settings-event-types';

// Event types in the game
const EVENT_TYPES = [
  'Matriarch', 'Harvester', 'Night Raid', 'Cold Snap', 'Electromagnetic Storm',
  'Bird City', 'Hidden Bunker', 'Launch Tower Loot', 'Locked Gate', 
  'Lush Blooms', 'Prospecting Probes', 'Uncovered Caches'
];

// App state
let bridge: EvenAppBridge | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let currentScreen: Screen = 'main';
let currentPage = 0;
let allEvents: GameEvent[] = [];
let hasMorePages = false;
let totalPages = 1;
let currentListItems: string[] = [];

// User preferences (persisted)
interface UserPrefs {
  autoLaunchScreen: Screen;
  favoriteEventTypes: string[];
}

let userPrefs: UserPrefs = {
  autoLaunchScreen: 'main',
  favoriteEventTypes: [],
};

// Logging
function logStatus(msg: string): void {
  console.log(msg);
  const status = document.getElementById('status');
  if (status) {
    const time = new Date().toLocaleTimeString();
    status.innerHTML = `[${time}] ${msg}<br>` + status.innerHTML;
  }
}

// Types
interface GameEvent {
  name: string;
  map: string;
  startTime: number;
  endTime?: number;
  type?: string;
}

// localStorage persistence
function savePrefs(): void {
  try {
    localStorage.setItem('arc-event-prefs', JSON.stringify(userPrefs));
    logStatus('Preferences saved');
  } catch (e) {
    console.error('Failed to save prefs:', e);
  }
}

function loadPrefs(): void {
  try {
    const saved = localStorage.getItem('arc-event-prefs');
    if (saved) {
      userPrefs = { ...userPrefs, ...JSON.parse(saved) };
      logStatus(`Loaded prefs: autoLaunch=${userPrefs.autoLaunchScreen}, favorites=${userPrefs.favoriteEventTypes.length}`);
    }
  } catch (e) {
    console.error('Failed to load prefs:', e);
  }
}

// Formatting helpers
function formatDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}hr ${mins}m` : `${hours}hr`;
  }
  return `${mins}m`;
}

function formatEventItem(event: GameEvent): string {
  const map = event.map || 'Unknown';
  const name = event.name || 'Event';
  const now = Date.now();
  
  let timeStr: string;
  if (event.startTime <= now) {
    if (event.endTime && event.endTime > now) {
      timeStr = `${formatDuration(event.endTime - now)} left`;
    } else {
      timeStr = 'Active';
    }
  } else {
    timeStr = `In ${formatDuration(event.startTime - now)}`;
  }
  
  return `${map}: ${name} (${timeStr})`;
}

function formatEventShort(event: GameEvent): string {
  const name = event.name || 'Event';
  const now = Date.now();
  let timeStr: string;
  if (event.startTime <= now) {
    timeStr = event.endTime ? `${formatDuration(event.endTime - now)}` : 'Now';
  } else {
    timeStr = formatDuration(event.startTime - now);
  }
  return `${name.substring(0, 12)} ${timeStr}`;
}

// Image helpers
async function sendHeaderImage(containerId: number = 2): Promise<void> {
  if (!bridge) return;
  try {
    const response = await fetch('/header.png');
    const arrayBuffer = await response.arrayBuffer();
    const imageData = Array.from(new Uint8Array(arrayBuffer));
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: containerId,
        containerName: 'header-logo',
        imageData: imageData,
      })
    );
  } catch (err) {
    console.error('[IMAGE] Header error:', err);
  }
}

async function sendSmallText(id: number, name: string, text: string, width: number, align: 'left' | 'right' = 'left'): Promise<void> {
  if (!bridge) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, 20);
    ctx.fillStyle = '#888888';
    ctx.font = '10px monospace';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, align === 'left' ? 2 : width - 2, 10);
    
    const base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: base64 })
    );
  } catch (err) {}
}

async function sendNavControls(id: number, name: string): Promise<void> {
  if (!bridge) return;
  try {
    const width = 160;
    const height = 44;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#888888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    
    ctx.fillText('2x Tap = Refresh', width - 4, 12);
    ctx.fillText('Scroll = Page', width - 4, 26);
    ctx.fillText('1x Tap = Menu', width - 4, 40);
    
    const base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: base64 })
    );
  } catch (err) {}
}

// Data fetching
async function fetchEvents(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/events`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  
  const data = await res.json();
  const events: GameEvent[] = data.events || data.data || [];
  const now = Date.now();
  const cutoff = now + TWELVE_HOURS_MS;
  
  allEvents = events
    .filter((e: GameEvent) => {
      const startTime = typeof e.startTime === 'number' ? e.startTime : new Date(e.startTime).getTime();
      const endTime = e.endTime ? (typeof e.endTime === 'number' ? e.endTime : new Date(e.endTime).getTime()) : null;
      if (endTime && endTime < now) return false;
      return startTime <= cutoff;
    })
    .sort((a, b) => {
      const aTime = typeof a.startTime === 'number' ? a.startTime : new Date(a.startTime).getTime();
      const bTime = typeof b.startTime === 'number' ? b.startTime : new Date(b.startTime).getTime();
      return aTime - bTime;
    })
    .map((e: GameEvent) => ({
      ...e,
      startTime: typeof e.startTime === 'number' ? e.startTime : new Date(e.startTime).getTime(),
      endTime: e.endTime ? (typeof e.endTime === 'number' ? e.endTime : new Date(e.endTime).getTime()) : undefined,
    }));
}

// ============ SCREEN: MAIN MENU ============
async function displayMainMenu(): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'main';
  const now = Date.now();
  const activeEvents = allEvents.filter(e => e.startTime <= now).slice(0, 6);
  
  // Menu items on left
  const menuItems = [
    'Favorite Events',
    'All Upcoming Events', 
    'Settings',
  ];
  
  currentListItems = menuItems;
  
  // Panel dimensions (compliant with 200x100 max per tile)
  const panelTileWidth = 200;
  const panelTileHeight = 100;
  const panelX = Math.floor(CANVAS_WIDTH * 0.45);
  
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [
        // Combined header with logo and hint (200x48)
        new ImageContainerProperty({
          containerID: 1,
          containerName: 'header',
          xPosition: Math.floor((CANVAS_WIDTH - LOGO_WIDTH) / 2),
          yPosition: 4,
          width: LOGO_WIDTH,
          height: 48,
        }),
        // Panel tile 1 (top)
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'panel-tile-0',
          xPosition: panelX,
          yPosition: LIST_Y_OFFSET,
          width: panelTileWidth,
          height: panelTileHeight,
        }),
        // Panel tile 2 (bottom)
        new ImageContainerProperty({
          containerID: 4,
          containerName: 'panel-tile-1',
          xPosition: panelX,
          yPosition: LIST_Y_OFFSET + panelTileHeight,
          width: panelTileWidth,
          height: panelTileHeight,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: 3,
          containerName: 'menu-list',
          xPosition: 0,
          yPosition: LIST_Y_OFFSET,
          width: Math.floor(CANVAS_WIDTH * 0.45),
          height: CANVAS_HEIGHT - LIST_Y_OFFSET,
          paddingLength: 0,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: menuItems.length,
            itemWidth: Math.floor(CANVAS_WIDTH * 0.45) - 16,
            isItemSelectBorderEn: 1,
            itemName: menuItems,
          }),
        }),
      ],
    })
  );
  
  await sendHeaderWithHint();
  await sendCurrentEventsPanelTiled(activeEvents, panelTileWidth, panelTileHeight);
}

// Send combined header with logo and hint text (for main menu)
async function sendHeaderWithHint(): Promise<void> {
  if (!bridge) return;
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_WIDTH;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, LOGO_WIDTH, 48);
    
    // Load and draw logo
    const logoImg = await loadImage('/header.png');
    const logoH = Math.min(logoImg.height, 40);
    const logoW = (logoImg.width / logoImg.height) * logoH;
    const logoX = (LOGO_WIDTH - logoW) / 2;
    ctx.drawImage(logoImg, logoX, 2, logoW, logoH);
    
    // Draw hint text below/beside logo
    ctx.fillStyle = '#888888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('2x Tap=Refresh', LOGO_WIDTH - 4, 44);
    
    const base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: 1, containerName: 'header', imageFormat: 'png', imageData: base64 })
    );
  } catch (err) {
    console.error('[IMAGE] Header with hint error:', err);
  }
}

// Send current events panel as tiled images (max 200x100 each)
async function sendCurrentEventsPanelTiled(events: GameEvent[], tileW: number, tileH: number): Promise<void> {
  if (!bridge) return;
  
  try {
    // Draw to a canvas covering both tiles
    const fullHeight = tileH * 2;
    const canvas = document.createElement('canvas');
    canvas.width = tileW;
    canvas.height = fullHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, tileW, fullHeight);
    
    // Header
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CURRENT', 4, 14);
    
    // Divider
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 20);
    ctx.lineTo(tileW - 4, 20);
    ctx.stroke();
    
    if (events.length === 0) {
      ctx.fillStyle = '#888888';
      ctx.font = '11px monospace';
      ctx.fillText('No active events', 4, 38);
    } else {
      const lineHeight = 32;
      let y = 34;
      const timerX = tileW - 8;
      
      for (const event of events) {
        const now = Date.now();
        const timeLeft = event.endTime ? formatDuration(event.endTime - now) : 'Now';
        
        ctx.fillStyle = '#00cccc';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(event.map?.substring(0, 18) || '', 4, y);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px monospace';
        ctx.fillText(event.name?.substring(0, 20) || '', 4, y + 12);
        
        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(timeLeft, timerX, y + 6);
        
        y += lineHeight;
        if (y > fullHeight - 16) break;
      }
    }
    
    // Extract and send each tile
    const tiles = [
      { id: 2, name: 'panel-tile-0', y: 0 },
      { id: 4, name: 'panel-tile-1', y: tileH },
    ];
    
    for (const tile of tiles) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tileW;
      tileCanvas.height = tileH;
      const tileCtx = tileCanvas.getContext('2d');
      if (!tileCtx) continue;
      
      tileCtx.drawImage(canvas, 0, tile.y, tileW, tileH, 0, 0, tileW, tileH);
      
      const base64 = tileCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: tile.id, containerName: tile.name, imageFormat: 'png', imageData: base64 })
      );
    }
  } catch (err) {
    console.error('[IMAGE] Tiled panel error:', err);
  }
}

// ============ SCREEN: ALL EVENTS (upcoming only) ============
async function displayAllEvents(page: number = 0): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'all-events';
  currentPage = page;
  const now = Date.now();
  
  const upcomingEvents = allEvents.filter(e => e.startTime > now);
  const totalEvents = upcomingEvents.length;
  totalPages = Math.ceil(totalEvents / EVENTS_PER_PAGE) || 1;
  
  if (totalEvents === 0) {
    totalPages = 1;
    currentListItems = ['No upcoming events', '', 'Click to return'];
    await displayEventsList(currentListItems, 'UPCOMING', 'Click=Menu', 'All Upcoming');
    return;
  }
  
  const startIdx = page * EVENTS_PER_PAGE;
  const endIdx = Math.min(startIdx + EVENTS_PER_PAGE, totalEvents);
  const pageEvents = upcomingEvents.slice(startIdx, endIdx);
  hasMorePages = endIdx < totalEvents;
  
  const listItems: string[] = [];
  for (const event of pageEvents) {
    listItems.push(formatEventItem(event));
  }
  
  currentListItems = listItems;
  await displayEventsList(listItems, `${page + 1}/${totalPages}`, 'Scroll=Pg  Click=Menu', 'All Upcoming');
}

// ============ SCREEN: FAVORITES ============
async function displayFavorites(page: number = 0): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'favorites';
  currentPage = page;
  
  if (userPrefs.favoriteEventTypes.length === 0) {
    totalPages = 1;
    currentListItems = ['No favorites set', 'Go to Settings to add'];
    await displayEventsList(currentListItems, 'FAVORITES', '', 'Favorites');
    return;
  }
  
  const now = Date.now();
  const favoriteEvents = allEvents.filter(e => 
    userPrefs.favoriteEventTypes.some(fav => 
      e.name?.toLowerCase().includes(fav.toLowerCase())
    )
  );
  
  if (favoriteEvents.length === 0) {
    totalPages = 1;
    currentListItems = ['No matching events', 'Check back later'];
    await displayEventsList(currentListItems, 'FAVORITES', '', 'Favorites');
    return;
  }
  
  const totalEvents = favoriteEvents.length;
  totalPages = Math.ceil(totalEvents / EVENTS_PER_PAGE) || 1;
  
  const startIdx = page * EVENTS_PER_PAGE;
  const endIdx = Math.min(startIdx + EVENTS_PER_PAGE, totalEvents);
  const pageEvents = favoriteEvents.slice(startIdx, endIdx);
  hasMorePages = endIdx < totalEvents;
  
  const listItems: string[] = [];
  for (const event of pageEvents) {
    listItems.push(formatEventItem(event));
  }
  
  currentListItems = listItems;
  await displayEventsList(listItems, `${page + 1}/${totalPages}`, '', 'Favorites');
}

// ============ SCREEN: SETTINGS ============
async function displaySettings(): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'settings';
  const listItems = [
    '<<< Back to Menu',
    `Auto-Launch: ${userPrefs.autoLaunchScreen}`,
    'Edit Favorite Event Types',
  ];
  
  currentListItems = listItems;
  await displaySimpleList(listItems, 'SETTINGS');
}

async function displaySettingsAutoLaunch(): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'settings-autolaunch';
  const options: Screen[] = ['main', 'favorites', 'all-events'];
  const listItems = [
    '<<< Back to Settings',
    ...options.map(o => `${o === userPrefs.autoLaunchScreen ? '[X] ' : '[ ] '}${o}`),
  ];
  
  currentListItems = listItems;
  await displaySimpleList(listItems, 'AUTO-LAUNCH');
}

// Event types pagination and selection
let eventTypesPage = 0;
let eventTypesSelectedIdx = 0; // 0 = Back, 1+ = event types
const EVENT_TYPES_PER_PAGE = 6;

async function displaySettingsEventTypes(page: number = 0, preserveSelection: boolean = false): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'settings-event-types';
  eventTypesPage = page;
  if (!preserveSelection) {
    eventTypesSelectedIdx = 0;
  }
  
  const totalPages = Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
  
  // 4 containers: 3 tiled images (max 200x100 each) + 1 text for event capture
  // Tile layout: 3 images covering top portion of screen
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [
        new ImageContainerProperty({
          containerID: 1,
          containerName: 'tile-0',
          xPosition: 0, yPosition: 0,
          width: 200, height: 100,
        }),
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'tile-1',
          xPosition: 200, yPosition: 0,
          width: 200, height: 100,
        }),
        new ImageContainerProperty({
          containerID: 3,
          containerName: 'tile-2',
          xPosition: 0, yPosition: 100,
          width: 200, height: 100,
        }),
      ],
      textObject: [
        new TextContainerProperty({
          containerID: 4,
          containerName: 'event-capture',
          xPosition: 0, yPosition: 0,
          width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
          isEventCapture: 1,
        }),
      ],
    })
  );
  
  await renderEventTypesContent(totalPages);
}

// Render content as tiled images (max 200x100 each per G2 constraints)
// Tiles: tile-0 (0,0,200,100), tile-1 (200,0,200,100), tile-2 (0,100,200,100)
async function renderEventTypesContent(totalPages?: number): Promise<void> {
  if (!bridge) return;
  
  try {
    const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
    const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
    const pages = totalPages ?? Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
    
    const rowHeight = 30;
    // Draw to a 400x200 canvas (covers our 3 tiles)
    const fullWidth = 400;
    const fullHeight = 200;
    
    const canvas = document.createElement('canvas');
    canvas.width = fullWidth;
    canvas.height = fullHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, fullWidth, fullHeight);
    
    // Draw page info at top
    ctx.font = 'bold 12px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#888888';
    ctx.fillText(`Page ${eventTypesPage + 1}/${pages}  Scroll=Page  Tap=Toggle`, 8, 6);
    
    // Draw "2x tap to save" hint on right side
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'right';
    ctx.fillText('2x Tap to Save', fullWidth - 8, 6);
    ctx.textAlign = 'left';
    
    ctx.font = 'bold 16px monospace';
    let y = 30;
    
    // Draw event types with checkboxes
    for (let i = 0; i < pageEventTypes.length; i++) {
      const eventType = pageEventTypes[i];
      const isChecked = userPrefs.favoriteEventTypes.includes(eventType);
      const isSelected = eventTypesSelectedIdx === i;
      
      // Outline if selected
      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, y - 2, fullWidth - 4, rowHeight);
      }
      
      // Checkbox
      ctx.fillStyle = isChecked ? '#00ff00' : '#666666';
      ctx.fillText(isChecked ? '[X]' : '[ ]', 8, y);
      
      // Event name
      ctx.fillStyle = isSelected ? '#ffffff' : '#cccccc';
      ctx.fillText(eventType, 48, y);
      
      y += rowHeight;
    }
    
    // Extract and send each tile
    const tiles = [
      { id: 1, name: 'tile-0', x: 0, y: 0, w: 200, h: 100 },
      { id: 2, name: 'tile-1', x: 200, y: 0, w: 200, h: 100 },
      { id: 3, name: 'tile-2', x: 0, y: 100, w: 200, h: 100 },
    ];
    
    for (const tile of tiles) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tile.w;
      tileCanvas.height = tile.h;
      const tileCtx = tileCanvas.getContext('2d');
      if (!tileCtx) continue;
      
      // Copy tile region from main canvas
      tileCtx.drawImage(canvas, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
      
      const dataUrl = tileCanvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: tile.id,
          containerName: tile.name,
          imageFormat: 'png',
          imageData: base64,
        })
      );
    }
  } catch (e) {
    console.error('renderEventTypesContent error:', e);
  }
}

// Helper to display a simple list screen (for menus with selectable items)
async function displaySimpleList(items: string[], title: string, disableSelection: boolean = false): Promise<void> {
  if (!bridge) return;
  
  const listItems = items.slice(0, MAX_LIST_ITEMS);
  
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [
        new ImageContainerProperty({
          containerID: 1,
          containerName: 'hint-left',
          xPosition: 4, yPosition: 4, width: 100, height: 20,
        }),
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'header-logo',
          xPosition: Math.floor((CANVAS_WIDTH - LOGO_WIDTH) / 2),
          yPosition: 4, width: LOGO_WIDTH, height: LOGO_HEIGHT,
        }),
        new ImageContainerProperty({
          containerID: 3,
          containerName: 'hint-right',
          xPosition: CANVAS_WIDTH - 130, yPosition: 4, width: 126, height: 20,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: 4,
          containerName: 'main-list',
          xPosition: 0,
          yPosition: LIST_Y_OFFSET,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT - LIST_Y_OFFSET,
          paddingLength: 4,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: listItems.length,
            itemWidth: CANVAS_WIDTH - 16,
            isItemSelectBorderEn: disableSelection ? 0 : 1,
            itemName: listItems,
          }),
        }),
      ],
    })
  );
  
  await sendSmallText(1, 'hint-left', title, 100, 'left');
  await sendSmallText(3, 'hint-right', '2x Tap = Refresh', 126, 'right');
  await sendHeaderImage();
}

// Display events as text (click=menu, 2x=refresh, scroll=page)
async function displayEventsList(items: string[], title: string, hint: string, sectionHeader?: string): Promise<void> {
  if (!bridge) return;
  
  // Add section header to content if provided
  let content: string;
  if (sectionHeader) {
    content = `--- ${sectionHeader} ---\n` + (items.length > 0 ? items.join('\n') : 'No events');
  } else {
    content = items.length > 0 ? items.join('\n') : 'No events';
  }
  
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [
        new ImageContainerProperty({
          containerID: 1,
          containerName: 'header-logo',
          xPosition: Math.floor((CANVAS_WIDTH - LOGO_WIDTH) / 2),
          yPosition: 4, width: LOGO_WIDTH, height: LOGO_HEIGHT,
        }),
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'page-info',
          xPosition: 4, yPosition: 4, width: 60, height: 20,
        }),
        new ImageContainerProperty({
          containerID: 3,
          containerName: 'nav-controls',
          xPosition: CANVAS_WIDTH - 164, yPosition: 2, width: 160, height: 44,
        }),
      ],
      textObject: [
        new TextContainerProperty({
          containerID: 4,
          containerName: 'events-text',
          content: content,
          xPosition: 8,
          yPosition: LIST_Y_OFFSET,
          width: CANVAS_WIDTH - 16,
          height: CANVAS_HEIGHT - LIST_Y_OFFSET,
          paddingLength: 4,
          isEventCapture: 1,
        }),
      ],
    })
  );
  
  await sendSmallText(2, 'page-info', title, 60, 'left');
  await sendNavControls(3, 'nav-controls');
  await sendHeaderImage(1);
}


// ============ SPLASH ANIMATION ============
async function showSplashAnimation(): Promise<void> {
  if (!bridge) return;
  
  const SPLASH_WIDTH = 200;
  const SPLASH_HEIGHT = 100;
  const FRAME_COUNT = 16;
  const FRAME_DELAY = 60;
  
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 1,
      imageObject: [
        new ImageContainerProperty({
          containerID: 1,
          containerName: 'splash-logo',
          xPosition: Math.floor((CANVAS_WIDTH - SPLASH_WIDTH) / 2),
          yPosition: Math.floor((CANVAS_HEIGHT - SPLASH_HEIGHT) / 2),
          width: SPLASH_WIDTH,
          height: SPLASH_HEIGHT,
        }),
      ],
    })
  );
  
  let logoImage: HTMLImageElement;
  try {
    logoImage = await loadImage('/header.png');
  } catch (err) {
    return;
  }
  
  for (let frame = 1; frame <= FRAME_COUNT; frame++) {
    const canvas = document.createElement('canvas');
    canvas.width = SPLASH_WIDTH;
    canvas.height = SPLASH_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, SPLASH_WIDTH, SPLASH_HEIGHT);
    
    const logoX = Math.floor((SPLASH_WIDTH - logoImage.width) / 2);
    const logoY = Math.floor((SPLASH_HEIGHT - logoImage.height) / 2);
    const t = frame / FRAME_COUNT;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const revealWidth = Math.floor(SPLASH_WIDTH * ease);
    
    ctx.drawImage(logoImage, logoX, logoY);
    ctx.fillStyle = '#000000';
    ctx.fillRect(revealWidth, 0, SPLASH_WIDTH - revealWidth, SPLASH_HEIGHT);
    
    if (frame < FRAME_COUNT) {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.fillRect(revealWidth, 0, 2, SPLASH_HEIGHT);
    }
    
    const base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: 1, containerName: 'splash-logo', imageData: base64 })
    );
    await sleep(FRAME_DELAY);
  }
  
  // Blink cursor
  const canvas = document.createElement('canvas');
  canvas.width = SPLASH_WIDTH;
  canvas.height = SPLASH_HEIGHT;
  const ctx = canvas.getContext('2d');
  const logoX = Math.floor((SPLASH_WIDTH - logoImage.width) / 2);
  const logoY = Math.floor((SPLASH_HEIGHT - logoImage.height) / 2);
  
  if (ctx) {
    for (let blink = 0; blink < 3; blink++) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, SPLASH_WIDTH, SPLASH_HEIGHT);
      ctx.drawImage(logoImage, logoX, logoY);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(SPLASH_WIDTH - 4, 0, 3, SPLASH_HEIGHT);
      
      let base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: 1, containerName: 'splash-logo', imageData: base64 })
      );
      await sleep(150);
      
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, SPLASH_WIDTH, SPLASH_HEIGHT);
      ctx.drawImage(logoImage, logoX, logoY);
      
      base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: 1, containerName: 'splash-logo', imageData: base64 })
      );
      await sleep(150);
    }
  }
  
  // Animate to header position
  const startX = Math.floor((CANVAS_WIDTH - SPLASH_WIDTH) / 2);
  const startY = Math.floor((CANVAS_HEIGHT - SPLASH_HEIGHT) / 2);
  const endX = Math.floor((CANVAS_WIDTH - LOGO_WIDTH) / 2);
  const endY = 4;
  
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const ease = 1 - Math.pow(1 - t, 3);
    
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        imageObject: [
          new ImageContainerProperty({
            containerID: 1,
            containerName: 'splash-logo',
            xPosition: Math.floor(startX + (endX - startX) * ease),
            yPosition: Math.floor(startY + (endY - startY) * ease),
            width: Math.floor(SPLASH_WIDTH + (LOGO_WIDTH - SPLASH_WIDTH) * ease),
            height: Math.floor(SPLASH_HEIGHT + (LOGO_HEIGHT - SPLASH_HEIGHT) * ease),
          }),
        ],
      })
    );
    
    const response = await fetch('/header.png');
    const arrayBuffer = await response.arrayBuffer();
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: 1,
        containerName: 'splash-logo',
        imageData: Array.from(new Uint8Array(arrayBuffer)),
      })
    );
    await sleep(60);
  }
  
  await sleep(100);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ NAVIGATION ============
async function navigateToScreen(screen: Screen): Promise<void> {
  currentPage = 0;
  switch (screen) {
    case 'main':
      await displayMainMenu();
      break;
    case 'favorites':
      await displayFavorites();
      break;
    case 'all-events':
      await displayAllEvents();
      break;
    case 'settings':
      await displaySettings();
      break;
    case 'settings-autolaunch':
      await displaySettingsAutoLaunch();
      break;
    case 'settings-event-types':
      await displaySettingsEventTypes();
      break;
  }
}

async function refreshAndDisplay(): Promise<void> {
  try {
    await showSplashAnimation();
    await fetchEvents();
    await navigateToScreen(userPrefs.autoLaunchScreen);
  } catch (err) {
    console.error('[ERROR]', err);
    currentListItems = ['Failed to load', 'Double-tap to retry'];
    await displaySimpleList(currentListItems, 'ERROR');
  }
}

// ============ EVENT HANDLING ============
async function handleEvent(event: EvenHubEvent): Promise<void> {
  const eventStr = JSON.stringify(event);
  logStatus(`Event: ${eventStr.substring(0, 80)}`);
  
  if (event.listEvent) {
    const itemIndex = event.listEvent.currentSelectItemIndex ?? 0;
    const itemName = event.listEvent.currentSelectItemName || currentListItems[itemIndex] || '';
    const eventType = event.listEvent.eventType;
    const isClick = eventType === 0 || eventType === undefined;
    const isDoubleClick = eventType === 3;
    const isScrollBottom = eventType === 2;
    const isScrollTop = eventType === 1;
    
    logStatus(`Click: "${itemName}" on ${currentScreen}`);
    
    // Double-tap refreshes
    if (isDoubleClick) {
      await refreshAndDisplay();
      return;
    }
    
    // Handle scroll pagination for event screens
    // Event types: 1 = scroll top boundary, 2 = scroll bottom boundary
    // Also check if at first/last item for immediate page change
    const atFirstItem = itemIndex === 0;
    const atLastItem = itemIndex === currentListItems.length - 1;
    
    if (currentScreen === 'all-events') {
      if ((isScrollBottom || (atLastItem && !isClick && !isDoubleClick)) && hasMorePages) {
        await displayAllEvents(currentPage + 1);
        return;
      }
      if ((isScrollTop || (atFirstItem && !isClick && !isDoubleClick)) && currentPage > 0) {
        await displayAllEvents(currentPage - 1);
        return;
      }
    }
    if (currentScreen === 'favorites') {
      if ((isScrollBottom || (atLastItem && !isClick && !isDoubleClick)) && hasMorePages) {
        await displayFavorites(currentPage + 1);
        return;
      }
      if ((isScrollTop || (atFirstItem && !isClick && !isDoubleClick)) && currentPage > 0) {
        await displayFavorites(currentPage - 1);
        return;
      }
    }
    
    if (isClick) {
      // Navigation based on current screen
      if (currentScreen === 'main') {
        if (itemName === 'Favorite Events') {
          await navigateToScreen('favorites');
        } else if (itemName === 'All Upcoming Events') {
          await navigateToScreen('all-events');
        } else if (itemName === 'Settings') {
          await navigateToScreen('settings');
        }
      } else if (currentScreen === 'favorites' || currentScreen === 'all-events') {
        // List events on these screens - shouldn't happen but handle anyway
        await navigateToScreen('main');
        return;
      } else if (currentScreen === 'settings') {
        if (itemName.includes('<<< Back')) {
          await navigateToScreen('main');
        } else if (itemName.includes('Auto-Launch')) {
          await navigateToScreen('settings-autolaunch');
        } else if (itemName.includes('Favorite Event Types')) {
          await navigateToScreen('settings-event-types');
        }
      } else if (currentScreen === 'settings-autolaunch') {
        if (itemName.includes('<<< Back')) {
          await navigateToScreen('settings');
        } else {
          // Toggle auto-launch option
          const options: Screen[] = ['main', 'favorites', 'all-events'];
          for (const opt of options) {
            if (itemName.includes(opt)) {
              userPrefs.autoLaunchScreen = opt;
              savePrefs();
              await displaySettingsAutoLaunch();
              break;
            }
          }
        }
      } else if (currentScreen === 'settings-event-types') {
        const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
        const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
        const maxIdx = pageEventTypes.length - 1;
        const totalPages = Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
        
        // Scroll moves selection
        if (isScrollBottom) {
          eventTypesSelectedIdx++;
          if (eventTypesSelectedIdx > maxIdx) {
            const nextPage = (eventTypesPage + 1) % totalPages;
            eventTypesSelectedIdx = 0;
            await displaySettingsEventTypes(nextPage, true);
          } else {
            await renderEventTypesContent();
          }
          return;
        }
        if (isScrollTop) {
          eventTypesSelectedIdx--;
          if (eventTypesSelectedIdx < 0) {
            const prevPage = eventTypesPage === 0 ? totalPages - 1 : eventTypesPage - 1;
            const prevPageTypes = EVENT_TYPES.slice(prevPage * EVENT_TYPES_PER_PAGE, (prevPage + 1) * EVENT_TYPES_PER_PAGE);
            eventTypesSelectedIdx = prevPageTypes.length - 1;
            await displaySettingsEventTypes(prevPage, true);
          } else {
            await renderEventTypesContent();
          }
          return;
        }
        
        // Single tap toggles selected event type
        if (isClick) {
          const eventType = pageEventTypes[eventTypesSelectedIdx];
          if (eventType) {
            const idx = userPrefs.favoriteEventTypes.indexOf(eventType);
            if (idx >= 0) {
              userPrefs.favoriteEventTypes.splice(idx, 1);
            } else {
              userPrefs.favoriteEventTypes.push(eventType);
            }
            savePrefs();
            await renderEventTypesContent();
          }
        }
      }
    }
  }
  
  // System events
  if (event.sysEvent) {
    const sysType = event.sysEvent.eventType;
    logStatus(`SYS: type=${sysType} on ${currentScreen}`);
    
    // Double-tap refresh
    if (sysType === 3) {
      await refreshAndDisplay();
      return;
    }
    
    // Handle settings-event-types via sysEvent
    if (currentScreen === 'settings-event-types') {
      const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
      const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
      const maxIdx = pageEventTypes.length - 1;
      const totalPgs = Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
      
      // Double tap (type 3) - go back to settings
      if (sysType === 3) {
        eventTypesSelectedIdx = 0;
        await navigateToScreen('settings');
        return;
      }
      
      // Scroll down (type 2)
      if (sysType === 2) {
        eventTypesSelectedIdx++;
        if (eventTypesSelectedIdx > maxIdx) {
          const nextPage = (eventTypesPage + 1) % totalPgs;
          eventTypesSelectedIdx = 0;
          await displaySettingsEventTypes(nextPage, true);
        } else {
          await renderEventTypesContent();
        }
        return;
      }
      
      // Scroll up (type 1)
      if (sysType === 1) {
        eventTypesSelectedIdx--;
        if (eventTypesSelectedIdx < 0) {
          const prevPage = eventTypesPage === 0 ? totalPgs - 1 : eventTypesPage - 1;
          const prevPageTypes = EVENT_TYPES.slice(prevPage * EVENT_TYPES_PER_PAGE, (prevPage + 1) * EVENT_TYPES_PER_PAGE);
          eventTypesSelectedIdx = prevPageTypes.length - 1;
          await displaySettingsEventTypes(prevPage, true);
        } else {
          await renderEventTypesContent();
        }
        return;
      }
      
      // Single tap (type 0) - toggle selected event type
      if (sysType === 0 || sysType === undefined) {
        const eventType = pageEventTypes[eventTypesSelectedIdx];
        if (eventType) {
          const idx = userPrefs.favoriteEventTypes.indexOf(eventType);
          if (idx >= 0) {
            userPrefs.favoriteEventTypes.splice(idx, 1);
          } else {
            userPrefs.favoriteEventTypes.push(eventType);
          }
          savePrefs();
          await renderEventTypesContent();
        }
        return;
      }
    }
    
    // Single click (type 0 or undefined) - return to menu from event screens
    if (sysType === 0 || sysType === undefined) {
      if (currentScreen === 'favorites' || currentScreen === 'all-events') {
        await navigateToScreen('main');
        return;
      }
    }
  }
  
  // Text container events (for events screens using text display)
  if (event.textEvent) {
    const textType = event.textEvent.eventType;
    logStatus(`TEXT: type=${textType} on ${currentScreen}`);
    
    // Double-tap refresh (type 3)
    if (textType === 3) {
      await refreshAndDisplay();
      return;
    }
    
    // Scroll down (type 2) - next page or move selection down
    if (textType === 2) {
      if (currentScreen === 'all-events') {
        const nextPage = currentPage + 1 >= totalPages ? 0 : currentPage + 1;
        await displayAllEvents(nextPage);
        return;
      }
      if (currentScreen === 'favorites') {
        const nextPage = currentPage + 1 >= totalPages ? 0 : currentPage + 1;
        await displayFavorites(nextPage);
        return;
      }
      if (currentScreen === 'settings-event-types') {
        const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
        const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
        const maxIdx = pageEventTypes.length - 1;
        const totalPgs = Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
        
        eventTypesSelectedIdx++;
        if (eventTypesSelectedIdx > maxIdx) {
          const nextPage = (eventTypesPage + 1) % totalPgs;
          eventTypesSelectedIdx = 0;
          await displaySettingsEventTypes(nextPage, true);
        } else {
          await renderEventTypesContent();
        }
        return;
      }
    }
    
    // Scroll up (type 1) - previous page
    if (textType === 1) {
      if (currentScreen === 'all-events') {
        const prevPage = currentPage - 1 < 0 ? totalPages - 1 : currentPage - 1;
        await displayAllEvents(prevPage);
        return;
      }
      if (currentScreen === 'favorites') {
        const prevPage = currentPage - 1 < 0 ? totalPages - 1 : currentPage - 1;
        await displayFavorites(prevPage);
        return;
      }
      if (currentScreen === 'settings-event-types') {
        const totalPgs = Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
        
        eventTypesSelectedIdx--;
        if (eventTypesSelectedIdx < 0) {
          const prevPage = eventTypesPage === 0 ? totalPgs - 1 : eventTypesPage - 1;
          const prevPageTypes = EVENT_TYPES.slice(prevPage * EVENT_TYPES_PER_PAGE, (prevPage + 1) * EVENT_TYPES_PER_PAGE);
          eventTypesSelectedIdx = prevPageTypes.length - 1;
          await displaySettingsEventTypes(prevPage, true);
        } else {
          await renderEventTypesContent();
        }
        return;
      }
    }
    
    // Double tap (type 3) - go back to settings from event types
    if (textType === 3) {
      if (currentScreen === 'settings-event-types') {
        eventTypesSelectedIdx = 0;
        await navigateToScreen('settings');
        return;
      }
      // Otherwise refresh
      await refreshAndDisplay();
      return;
    }
    
    // Click (type 0) - return to menu or toggle selection
    if (textType === 0 || textType === undefined) {
      if (currentScreen === 'favorites' || currentScreen === 'all-events') {
        await navigateToScreen('main');
        return;
      }
      if (currentScreen === 'settings-event-types') {
        const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
        const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
        
        const eventType = pageEventTypes[eventTypesSelectedIdx];
        if (eventType) {
          const idx = userPrefs.favoriteEventTypes.indexOf(eventType);
          if (idx >= 0) {
            userPrefs.favoriteEventTypes.splice(idx, 1);
          } else {
            userPrefs.favoriteEventTypes.push(eventType);
          }
          savePrefs();
          await renderEventTypesContent();
        }
        return;
      }
    }
  }
}

// ============ INIT ============
async function init(): Promise<void> {
  logStatus('Starting...');
  
  loadPrefs();
  
  bridge = await waitForEvenAppBridge();
  logStatus('Bridge connected');
  
  bridge.onEvenHubEvent(handleEvent);
  
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: 'loading',
          content: 'Loading...',
          xPosition: 0, yPosition: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
          paddingLength: 16, isEventCapture: 1,
        }),
      ],
    })
  );
  
  await refreshAndDisplay();
  
  refreshTimer = setInterval(async () => {
    await fetchEvents();
    // Only auto-refresh display if on events screens
    if (currentScreen === 'all-events') {
      await displayAllEvents(currentPage);
    } else if (currentScreen === 'favorites') {
      await displayFavorites(currentPage);
    } else if (currentScreen === 'main') {
      await displayMainMenu();
    }
  }, REFRESH_INTERVAL);
  
  // Keyboard shortcuts
  document.addEventListener('keydown', async (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      await refreshAndDisplay();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      await navigateToScreen('main');
    }
  });
  
  logStatus('Ready');
}

init().catch(console.error);
