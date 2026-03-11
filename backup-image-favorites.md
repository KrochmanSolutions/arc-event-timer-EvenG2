# Image-Based Favorites Selection - Backup

This backup contains the image-based implementation of the "Edit Favorite Event Types" screen
using tiled images (3x 200x100 tiles) to work within G2 hardware constraints.

## Why It Was Replaced
- toBlob() is slow on real G2 hardware
- Each tile update requires canvas rendering + toBlob + BLE transfer
- Scrolling text required frequent re-renders making it too slow

## Implementation Details
- Used 3 tiled ImageContainerProperty (max 200x100 each per G2.md)
- Canvas-based rendering with custom checkbox drawing
- Scrolling text effect for long event names
- Selection highlight using strokeRect outline

## displaySettingsEventTypes Function

```typescript
async function displaySettingsEventTypes(page: number = 0, preserveSelection: boolean = false): Promise<void> {
  if (!bridge) return;
  
  currentScreen = 'settings-event-types';
  eventTypesPage = page;
  if (!preserveSelection) {
    eventTypesSelectedIdx = 0;
  }
  
  const totalPages = Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
  
  // 4 containers: 3 tiled images (max 200x100 each) + 1 text for event capture
  // Tile layout: 3 images centered on screen (400x200 content area)
  const contentWidth = 400;
  const contentHeight = 200;
  const xOffset = Math.floor((CANVAS_WIDTH - contentWidth) / 2);
  const yOffset = Math.floor((CANVAS_HEIGHT - contentHeight) / 2);
  
  // Text container FIRST (containerID 1) so it's behind images for event capture
  // Images on top (containerIDs 2, 3, 4) - higher IDs draw on top
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: 'event-capture',
          content: ' ',
          xPosition: 0, yPosition: 0,
          width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
          isEventCapture: 1,
        }),
      ],
      imageObject: [
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'tile-0',
          xPosition: xOffset, yPosition: yOffset,
          width: 200, height: 100,
        }),
        new ImageContainerProperty({
          containerID: 3,
          containerName: 'tile-1',
          xPosition: xOffset + 200, yPosition: yOffset,
          width: 200, height: 100,
        }),
        new ImageContainerProperty({
          containerID: 4,
          containerName: 'tile-2',
          xPosition: xOffset, yPosition: yOffset + 100,
          width: 200, height: 100,
        }),
      ],
    })
  );
  
  // Clear any existing timers and reset scroll state BEFORE rendering
  if (eventTypesScrollDelay) {
    clearTimeout(eventTypesScrollDelay);
    eventTypesScrollDelay = null;
  }
  if (eventTypesScrollTimer) {
    clearInterval(eventTypesScrollTimer);
    eventTypesScrollTimer = null;
  }
  eventTypesScrollOffset = 0;
  
  await renderEventTypesContent(totalPages);
  
  // Calculate max scroll steps needed (longest item determines cycle)
  const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
  const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
  const maxDisplayLen = 12;
  const maxScrollSteps = Math.max(0, ...pageEventTypes.map(name => 
    name.length > maxDisplayLen ? name.length - maxDisplayLen : 0
  ));
  
  if (maxScrollSteps > 0) {
    const startScrollCycle = () => {
      if (currentScreen !== 'settings-event-types') return;
      
      eventTypesScrollTimer = setInterval(async () => {
        if (currentScreen !== 'settings-event-types') {
          if (eventTypesScrollTimer) clearInterval(eventTypesScrollTimer);
          eventTypesScrollTimer = null;
          return;
        }
        eventTypesScrollOffset++;
        await renderEventTypesContent();
        if (eventTypesScrollOffset >= maxScrollSteps) {
          if (eventTypesScrollTimer) clearInterval(eventTypesScrollTimer);
          eventTypesScrollTimer = null;
          eventTypesScrollDelay = setTimeout(async () => {
            if (currentScreen !== 'settings-event-types') return;
            eventTypesScrollOffset = 0;
            await renderEventTypesContent();
            eventTypesScrollDelay = setTimeout(startScrollCycle, 3000);
          }, 3000);
        }
      }, 400);
    };
    
    eventTypesScrollDelay = setTimeout(startScrollCycle, 3000);
  }
}
```

## renderEventTypesContent Function

```typescript
async function renderEventTypesContent(totalPages?: number): Promise<void> {
  if (!bridge) return;
  
  try {
    const startIdx = eventTypesPage * EVENT_TYPES_PER_PAGE;
    const pageEventTypes = EVENT_TYPES.slice(startIdx, startIdx + EVENT_TYPES_PER_PAGE);
    const pages = totalPages ?? Math.ceil(EVENT_TYPES.length / EVENT_TYPES_PER_PAGE);
    
    const rowHeight = 30;
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
    
    ctx.font = '14px monospace';
    let y = 30;
    const maxDisplayLen = 12;
    
    // Draw event types with checkboxes
    for (let i = 0; i < pageEventTypes.length; i++) {
      const eventType = pageEventTypes[i];
      const isChecked = userPrefs.favoriteEventTypes.includes(eventType);
      const isSelected = eventTypesSelectedIdx === i;
      
      // Outline if selected
      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, y - 2, 196, rowHeight);
      }
      
      // Checkbox
      ctx.fillStyle = isChecked ? '#00ff00' : '#666666';
      ctx.fillText(isChecked ? '[X]' : '[ ]', 8, y);
      
      // Event name with scrolling
      ctx.fillStyle = isSelected ? '#ffffff' : '#cccccc';
      let displayName: string;
      if (eventType.length <= maxDisplayLen) {
        displayName = eventType;
      } else {
        const maxOffset = eventType.length - maxDisplayLen;
        const effectiveOffset = Math.min(eventTypesScrollOffset, maxOffset);
        displayName = eventType.substring(effectiveOffset, effectiveOffset + maxDisplayLen);
      }
      ctx.fillText(displayName, 45, y);
      
      y += rowHeight;
    }
    
    // Extract and send each tile
    const tiles = [
      { id: 2, name: 'tile-0', x: 0, y: 0, w: 200, h: 100 },
      { id: 3, name: 'tile-1', x: 200, y: 0, w: 200, h: 100 },
      { id: 4, name: 'tile-2', x: 0, y: 100, w: 200, h: 100 },
    ];
    
    for (const tile of tiles) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tile.w;
      tileCanvas.height = tile.h;
      const tileCtx = tileCanvas.getContext('2d');
      if (!tileCtx) continue;
      
      tileCtx.drawImage(canvas, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
      
      const blob = await new Promise<Blob>((resolve) => tileCanvas.toBlob(resolve!, 'image/png'));
      const arrayBuffer = await blob.arrayBuffer();
      const imageData = Array.from(new Uint8Array(arrayBuffer));
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: tile.id,
          containerName: tile.name,
          imageData,
        })
      );
    }
  } catch (e) {
    console.error('renderEventTypesContent error:', e);
  }
}
```

## State Variables Used

```typescript
let eventTypesPage = 0;
let eventTypesSelectedIdx = 0;
let eventTypesScrollOffset = 0;
let eventTypesScrollTimer: ReturnType<typeof setInterval> | null = null;
let eventTypesScrollDelay: ReturnType<typeof setTimeout> | null = null;
const EVENT_TYPES_PER_PAGE = 5;
```

## Future Exploration Ideas
- Pre-render all tiles during splash screen
- Use simpler grayscale format instead of PNG
- Reduce tile count to 2 for faster updates
- Consider WebAssembly for faster image encoding
