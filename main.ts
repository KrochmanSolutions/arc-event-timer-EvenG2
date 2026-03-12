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

// Pre-rendered image cache for instant navigation
const imageCache: Map<string, number[]> = new Map();

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

// Pre-load header PNG (only static asset)
async function preloadImages(): Promise<void> {
  const response = await fetch('/header.png');
  const arrayBuffer = await response.arrayBuffer();
  imageCache.set('header-logo', Array.from(new Uint8Array(arrayBuffer)));
}

// Image helpers
async function sendHeaderImage(containerId: number = 2): Promise<void> {
  if (!bridge) return;
  const cached = imageCache.get('header-logo');
  if (cached) {
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: containerId, containerName: 'header-logo', imageData: cached })
    );
  }
}

async function sendSmallText(id: number, name: string, text: string, width: number, align: 'left' | 'right' = 'left'): Promise<void> {
  if (!bridge) return;
  
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
  
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob(resolve!, 'image/png'));
  const arrayBuffer = await blob.arrayBuffer();
  const imageData = Array.from(new Uint8Array(arrayBuffer));
  await bridge.updateImageRawData(
    new ImageRawDataUpdate({ containerID: id, containerName: name, imageData })
  );
}

async function sendNavControls(id: number, name: string): Promise<void> {
  if (!bridge) return;
  
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 44;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 160, 44);
  ctx.fillStyle = '#888888';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('2x Tap = Refresh', 156, 12);
  ctx.fillText('Scroll = Page', 156, 26);
  ctx.fillText('1x Tap = Menu', 156, 40);
  
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob(resolve!, 'image/png'));
  const arrayBuffer = await blob.arrayBuffer();
  const imageData = Array.from(new Uint8Array(arrayBuffer));
  await bridge.updateImageRawData(
    new ImageRawDataUpdate({ containerID: id, containerName: name, imageData })
  );
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
  const menuWidth = Math.floor(CANVAS_WIDTH * 0.45);
  
  // Center the content (menu + panel)
  const totalContentWidth = menuWidth + panelTileWidth;
  const leftMargin = Math.floor((CANVAS_WIDTH - totalContentWidth) / 2);
  const panelX = leftMargin + menuWidth;
  
  // Single rebuild with full layout - no mid-animation rebuild
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [
        new ImageContainerProperty({
          containerID: 1,
          containerName: 'header',
          xPosition: Math.floor((CANVAS_WIDTH - LOGO_WIDTH) / 2),
          yPosition: 4,
          width: LOGO_WIDTH,
          height: 48,
        }),
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'panel-tile-0',
          xPosition: panelX,
          yPosition: LIST_Y_OFFSET,
          width: panelTileWidth,
          height: panelTileHeight,
        }),
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
          xPosition: leftMargin,
          yPosition: 0,
          width: menuWidth,
          height: CANVAS_HEIGHT,
          paddingLength: 0,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: menuItems.length,
            itemWidth: menuWidth - 16,
            isItemSelectBorderEn: 1,
            itemName: menuItems,
          }),
        }),
      ],
    })
  );
  
  // Header animation plays first (no rebuild to clear it)
  await sendHeaderWithHint();
  
  // Then current events load progressively
  await sendCurrentEventsPanelTiled(activeEvents, panelTileWidth, panelTileHeight);
}

// Send combined header with logo and hint text (for main menu)
async function sendHeaderWithHint(): Promise<void> {
  if (!bridge) return;
  
  try {
    const HEADER_W = LOGO_WIDTH;
    const HEADER_H = 48;
    const SPLASH_W = 153;
    const SPLASH_H = 30;
    
    // Animate through splash frames - frame 3 becomes the final header
    const framePaths = ['/splash-frame-1.png', '/splash-frame-2.png', '/splash-frame-3.png'];
    for (const path of framePaths) {
      const splashImg = await loadImage(path);
      const canvas = document.createElement('canvas');
      canvas.width = HEADER_W;
      canvas.height = HEADER_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, HEADER_W, HEADER_H);
      
      // Center splash frame in header - same position for all frames
      const splashX = Math.floor((HEADER_W - SPLASH_W) / 2);
      const splashY = Math.floor((HEADER_H - SPLASH_H) / 2);
      ctx.drawImage(splashImg, splashX, splashY, SPLASH_W, SPLASH_H);
      
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob(resolve!, 'image/png'));
      const arrayBuffer = await blob.arrayBuffer();
      const imageData = Array.from(new Uint8Array(arrayBuffer));
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: 1, containerName: 'header', imageData })
      );
      await sleep(50);
    }
    // Frame 3 remains as the final header - no additional update needed
  } catch (err) {
    console.error('[IMAGE] Header error:', err);
  }
}

// Send just the final header frame (no animation) - used after page rebuild
async function sendHeaderFinal(): Promise<void> {
  if (!bridge) return;
  
  try {
    const HEADER_W = LOGO_WIDTH;
    const HEADER_H = 48;
    const SPLASH_W = 153;
    const SPLASH_H = 30;
    
    // Just send frame 3 (the final header)
    const splashImg = await loadImage('/splash-frame-3.png');
    const canvas = document.createElement('canvas');
    canvas.width = HEADER_W;
    canvas.height = HEADER_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, HEADER_W, HEADER_H);
    
    const splashX = Math.floor((HEADER_W - SPLASH_W) / 2);
    const splashY = Math.floor((HEADER_H - SPLASH_H) / 2);
    ctx.drawImage(splashImg, splashX, splashY, SPLASH_W, SPLASH_H);
    
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob(resolve!, 'image/png'));
    const arrayBuffer = await blob.arrayBuffer();
    const imageData = Array.from(new Uint8Array(arrayBuffer));
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: 1, containerName: 'header', imageData })
    );
  } catch (err) {
    console.error('[IMAGE] Header final error:', err);
  }
}

// Send current events panel as tiled images (max 200x100 each)
async function sendCurrentEventsPanelTiled(events: GameEvent[], tileW: number, tileH: number): Promise<void> {
  if (!bridge) return;
  
  try {
    const fullHeight = tileH * 2;
    const lineHeight = 32;
    const timerX = tileW - 8;
    
    // Helper to render canvas up to a certain number of events and send tiles
    const renderAndSend = async (eventCount: number, sendTile0: boolean, sendTile1: boolean) => {
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
      
      ctx.fillStyle = '#888888';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('2x Tap=Refresh', tileW - 4, 14);
      ctx.textAlign = 'left';
      
      // Divider
      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(4, 20);
      ctx.lineTo(tileW - 4, 20);
      ctx.stroke();
      
      if (events.length === 0 && eventCount === 0) {
        ctx.fillStyle = '#888888';
        ctx.font = '11px monospace';
        ctx.fillText('No active events', 4, 38);
      } else {
        let y = 34;
        for (let i = 0; i < Math.min(eventCount, events.length); i++) {
          const event = events[i];
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
      
      // Pre-render both tiles to image data first
      const tileUpdates: Promise<void>[] = [];
      
      if (sendTile0) {
        const tile0Canvas = document.createElement('canvas');
        tile0Canvas.width = tileW;
        tile0Canvas.height = tileH;
        const tile0Ctx = tile0Canvas.getContext('2d');
        if (tile0Ctx) {
          tile0Ctx.drawImage(canvas, 0, 0, tileW, tileH, 0, 0, tileW, tileH);
          const blob0 = await new Promise<Blob>((resolve) => tile0Canvas.toBlob(resolve!, 'image/png'));
          const arrayBuffer0 = await blob0.arrayBuffer();
          const imageData0 = Array.from(new Uint8Array(arrayBuffer0));
          tileUpdates.push(
            bridge.updateImageRawData(
              new ImageRawDataUpdate({ containerID: 2, containerName: 'panel-tile-0', imageData: imageData0 })
            )
          );
        }
      }
      
      if (sendTile1) {
        const tile1Canvas = document.createElement('canvas');
        tile1Canvas.width = tileW;
        tile1Canvas.height = tileH;
        const tile1Ctx = tile1Canvas.getContext('2d');
        if (tile1Ctx) {
          tile1Ctx.drawImage(canvas, 0, tileH, tileW, tileH, 0, 0, tileW, tileH);
          const blob1 = await new Promise<Blob>((resolve) => tile1Canvas.toBlob(resolve!, 'image/png'));
          const arrayBuffer1 = await blob1.arrayBuffer();
          const imageData1 = Array.from(new Uint8Array(arrayBuffer1));
          tileUpdates.push(
            bridge.updateImageRawData(
              new ImageRawDataUpdate({ containerID: 4, containerName: 'panel-tile-1', imageData: imageData1 })
            )
          );
        }
      }
      
      // Send both tiles simultaneously
      await Promise.all(tileUpdates);
    };
    
    // Stage 1: Just the header (no events) - initialize BOTH tiles
    await renderAndSend(0, true, true);
    await sleep(30);
    
    // Stage 2+: Add events one by one
    // Layout: header ~20px, events start at y=34, each row is 32px
    // Tile boundary at 100px, so event 3 (y=98-130) crosses into tile 1
    // Always update both tiles to avoid visual glitches
    const maxEvents = Math.min(events.length, 6);
    for (let i = 1; i <= maxEvents; i++) {
      await renderAndSend(i, true, true);
      await sleep(30);
    }
  } catch (err) {
    console.error('[IMAGE] Tiled panel error:', err);
  }
}

// Lightweight refresh for main menu - only updates event rows (no header animation)
async function refreshMainMenuEvents(): Promise<void> {
  if (!bridge) return;
  
  const panelTileWidth = 200;
  const panelTileHeight = 100;
  
  // Clear both tiles simultaneously first
  const clearCanvas = document.createElement('canvas');
  clearCanvas.width = panelTileWidth;
  clearCanvas.height = panelTileHeight;
  const clearCtx = clearCanvas.getContext('2d');
  if (clearCtx) {
    clearCtx.fillStyle = '#000000';
    clearCtx.fillRect(0, 0, panelTileWidth, panelTileHeight);
    const clearBlob = await new Promise<Blob>((resolve) => clearCanvas.toBlob(resolve!, 'image/png'));
    const clearBuffer = await clearBlob.arrayBuffer();
    const clearData = Array.from(new Uint8Array(clearBuffer));
    
    // Send clear to both tiles at once
    await Promise.all([
      bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: 2, containerName: 'panel-tile-0', imageData: clearData })
      ),
      bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: 4, containerName: 'panel-tile-1', imageData: clearData })
      ),
    ]);
  }
  
  await fetchEvents();
  
  const now = Date.now();
  const activeEvents = allEvents.filter(e => e.startTime <= now).slice(0, 6);
  
  // Progressive load of event rows
  await sendCurrentEventsPanelTiled(activeEvents, panelTileWidth, panelTileHeight);
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

// Event types selection
let eventTypesSelectedIdx = 0;

async function displaySettingsEventTypes(): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'settings-event-types';
  
  // Build list items with checkboxes - add Back option at top
  const listItems = [
    '<<< Back to Settings',
    ...EVENT_TYPES.map((eventType) => {
      const isChecked = userPrefs.favoriteEventTypes.includes(eventType);
      const checkbox = isChecked ? '[X] ' : '[ ] ';
      return `${checkbox}${eventType}`;
    }),
  ];
  
  currentListItems = listItems;
  await displaySimpleList(listItems, 'FAVORITES');
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
  
  // Splash frames are 153x30 - container must match image size
  const SPLASH_WIDTH = 153;
  const SPLASH_HEIGHT = 30;
  
  logStatus('Starting splash animation...');
  
  // Create container - size must match image dimensions exactly
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
  
  // Load all 3 splash frames
  const framePaths = ['/splash-frame-1.png', '/splash-frame-2.png', '/splash-frame-3.png'];
  const frames: number[][] = [];
  
  for (const path of framePaths) {
    try {
      logStatus(`Loading ${path}...`);
      const response = await fetch(path);
      if (!response.ok) {
        logStatus(`Failed to fetch ${path}: ${response.status}`);
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      const imageData = Array.from(new Uint8Array(arrayBuffer));
      logStatus(`Loaded ${path}: ${imageData.length} bytes`);
      frames.push(imageData);
    } catch (err) {
      logStatus(`Error loading ${path}: ${err}`);
      return;
    }
  }
  
  logStatus(`Playing ${frames.length} frames...`);
  
  // Play all frames with minimal delay to ensure each frame is visible
  for (let i = 0; i < frames.length; i++) {
    logStatus(`Sending frame ${i + 1}...`);
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ 
        containerID: 1, 
        containerName: 'splash-logo', 
        imageData: frames[i] 
      })
    );
    // Small delay to ensure frame is visible on hardware
    await sleep(100);
  }
  
  // Hold final frame longer before proceeding
  await sleep(500);
  logStatus('Splash animation complete');
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
      // Re-fetch events when returning to main menu
      await fetchEvents();
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
    await preloadImages();
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
      if (currentScreen === 'main') {
        await refreshMainMenuEvents();
      } else {
        await refreshAndDisplay();
      }
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
        // Settings has 3 items: Back (0), Auto-Launch (1), Edit Favorites (2)
        // Try itemName first, then fall back to index
        logStatus(`Settings click: idx=${itemIndex} name="${itemName}"`);
        if (itemName.includes('<<< Back') || itemName.includes('Back to Menu')) {
          await navigateToScreen('main');
        } else if (itemName.includes('Auto-Launch')) {
          await navigateToScreen('settings-autolaunch');
        } else if (itemName.includes('Favorite') || itemName.includes('Event Types')) {
          await navigateToScreen('settings-event-types');
        } else {
          // Fallback to index if name doesn't match
          if (itemIndex === 0) {
            await navigateToScreen('main');
          } else if (itemIndex === 1) {
            await navigateToScreen('settings-autolaunch');
          } else if (itemIndex === 2) {
            await navigateToScreen('settings-event-types');
          }
        }
      } else if (currentScreen === 'settings-autolaunch') {
        // Auto-launch has 4 items: Back (0), main (1), favorites (2), all-events (3)
        logStatus(`AutoLaunch click: idx=${itemIndex} name="${itemName}"`);
        if (itemName.includes('<<< Back') || itemName.includes('Settings')) {
          await navigateToScreen('settings');
        } else if (itemName.includes('main') || itemIndex === 1) {
          userPrefs.autoLaunchScreen = 'main';
          savePrefs();
          await displaySettingsAutoLaunch();
        } else if (itemName.includes('favorites') || itemIndex === 2) {
          userPrefs.autoLaunchScreen = 'favorites';
          savePrefs();
          await displaySettingsAutoLaunch();
        } else if (itemName.includes('all-events') || itemIndex === 3) {
          userPrefs.autoLaunchScreen = 'all-events';
          savePrefs();
          await displaySettingsAutoLaunch();
        } else if (itemIndex === 0) {
          // Fallback for back
          await navigateToScreen('settings');
        }
      } else if (currentScreen === 'settings-event-types') {
        // List has: Back (0), then event types (1-12)
        logStatus(`EventTypes click: idx=${itemIndex} name="${itemName}"`);
        
        if (itemIndex === 0 || itemName.includes('<<< Back') || itemName.includes('Settings')) {
          // Go back to settings
          savePrefs();
          await navigateToScreen('settings');
        } else {
          // Toggle event type (index 1+ maps to EVENT_TYPES[index-1])
          const eventTypeIdx = itemIndex - 1;
          if (eventTypeIdx >= 0 && eventTypeIdx < EVENT_TYPES.length) {
            const eventType = EVENT_TYPES[eventTypeIdx];
            const idx = userPrefs.favoriteEventTypes.indexOf(eventType);
            if (idx >= 0) {
              userPrefs.favoriteEventTypes.splice(idx, 1);
            } else {
              userPrefs.favoriteEventTypes.push(eventType);
            }
            savePrefs();
            await displaySettingsEventTypes();
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
      if (currentScreen === 'main') {
        await refreshMainMenuEvents();
      } else {
        await refreshAndDisplay();
      }
      return;
    }
    
    // Handle settings-event-types via sysEvent
    if (currentScreen === 'settings-event-types') {
      // Double tap - save and go back
      if (sysType === 3) {
        savePrefs();
        await navigateToScreen('settings');
        return;
      }
      
      // Single tap - go back
      if (sysType === 0 || sysType === undefined) {
        savePrefs();
        await navigateToScreen('settings');
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
      if (currentScreen === 'main') {
        await refreshMainMenuEvents();
      } else {
        await refreshAndDisplay();
      }
      return;
    }
    
    // Scroll down (type 2) - next page
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
    }
    
    // Click (type 0) - return to menu from event screens
    if (textType === 0 || textType === undefined) {
      if (currentScreen === 'favorites' || currentScreen === 'all-events') {
        await navigateToScreen('main');
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
  
  // Minimal startup - splash animation will take over immediately
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: 'startup',
          content: ' ',
          xPosition: 0, yPosition: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
          isEventCapture: 1,
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
