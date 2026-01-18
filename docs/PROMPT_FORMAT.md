# Prompt Format Specification

This document defines the standard format for AI-generated prompts used in the stock image creation workflow.

---

## Overview

Prompts must be wrapped in markers and include metadata that flows through the pipeline:

```
[PROMPT START]
Title: <stock-ready title>
Keywords: <comma-separated keywords>
Aspect Ratio: <ratio>
===
<generation prompt>
[PROMPT END]
```

---

## Complete Format

### Structure

```
[PROMPT START]
Title: Descriptive Title for Adobe Stock Submission
Keywords: keyword1, keyword2, keyword3, keyword4, keyword5, keyword6
Aspect Ratio: 16:9
===
The actual image generation prompt goes here. This is the text that will be
sent to ComfyUI for image generation. Include all necessary details about
style, composition, lighting, quality, and technical specifications.
[PROMPT END]
```

### Components

| Component | Required | Description |
|-----------|----------|-------------|
| `[PROMPT START]` | Yes | Opening marker |
| `Title:` | Recommended | Adobe Stock title (40-70 chars) |
| `Keywords:` | Recommended | Comma-separated keywords (up to 49) |
| `Aspect Ratio:` | Optional | Image dimensions ratio |
| `===` | Recommended | Separator between metadata and prompt |
| Generation Prompt | Yes | Text sent to ComfyUI |
| `[PROMPT END]` | Yes | Closing marker |

---

## Markers

### Default Markers

```
Start: [PROMPT START]
End:   [PROMPT END]
```

### Marker Rules
- Case-sensitive (must match exactly)
- Must be on their own line or clearly separated
- Configurable in extension settings if needed
- No spaces inside brackets

### Examples

**Valid:**
```
[PROMPT START]
...content...
[PROMPT END]
```

**Invalid:**
```
[ PROMPT START ]    ← spaces inside brackets
[prompt start]      ← lowercase
[PROMPT_START]      ← underscore instead of space
```

---

## Metadata Fields

### Title

**Purpose:** Pre-fills the Adobe Stock title field in the CSV app.

**Format:**
```
Title: Your Descriptive Title Here
```

**Guidelines:**
- 40-70 characters (Adobe Stock requirement)
- Descriptive and searchable
- No special characters
- Capitalize main words
- Focus on the "what" and "where"

**Examples:**
```
Title: Serene Mountain Lake at Golden Hour
Title: Professional Business Team Meeting in Modern Office
Title: Fresh Organic Vegetables on Rustic Wooden Table
```

### Keywords

**Purpose:** Pre-fills the Adobe Stock keywords field.

**Format:**
```
Keywords: word1, word2, word3, word4, word5
```

**Guidelines:**
- Comma-separated list
- Single words only (no phrases)
- Lowercase preferred
- Up to 49 keywords for Adobe Stock
- Most relevant keywords first
- Include variations (sunset, sunsets, sunlight)

**Examples:**
```
Keywords: mountain, lake, sunset, nature, landscape, peaceful, reflection, water
Keywords: business, team, meeting, office, professional, corporate, teamwork
Keywords: vegetables, organic, fresh, healthy, food, cooking, ingredients
```

### Aspect Ratio

**Purpose:** Sets image dimensions before generation.

**Format:**
```
Aspect Ratio: W:H
```

**Available Ratios:**

| Ratio | Symbol | Orientation | Use Case |
|-------|--------|-------------|----------|
| 1:1 | Square | Square | Instagram, profile pics |
| 5:4 | Landscape | Landscape | Classic print |
| 4:3 | Landscape | Landscape | Presentation, monitor |
| 3:2 | Landscape | Landscape | DSLR standard |
| 16:9 | Landscape | Landscape | Video, widescreen |
| 2:1 | Landscape | Landscape | Panoramic |
| 21:9 | Landscape | Landscape | Ultra-wide |
| 32:9 | Landscape | Landscape | Super ultra-wide |
| 4:5 | Portrait | Portrait | Instagram portrait |
| 3:4 | Portrait | Portrait | Portrait print |
| 2:3 | Portrait | Portrait | Portrait DSLR |
| 9:16 | Portrait | Portrait | Mobile, stories |
| 1:2 | Portrait | Portrait | Tall banner |

**AI Recommendations:**
When asking AI to suggest aspect ratios, consider:
- **Landscapes, scenery:** 16:9, 3:2, 2:1
- **Portraits, people:** 4:5, 2:3, 3:4
- **Products, objects:** 1:1, 4:3
- **Mobile content:** 9:16, 4:5
- **Presentations:** 16:9, 4:3

---

## Separator

### Purpose
The `===` separator divides metadata from the generation prompt.

### Placement
```
Title: ...
Keywords: ...
Aspect Ratio: ...
===
<generation prompt starts here>
```

### Why Use a Separator?
1. Clear distinction between metadata and prompt
2. Extension can strip metadata before sending to ComfyUI
3. Workflow nodes (AGSoftTextSplit) can parse the format
4. CSV app can extract pre-existing metadata from PNG

---

## Generation Prompt

### Purpose
The actual text sent to ComfyUI for image generation.

### Best Practices

**Include:**
- Main subject description
- Style and mood
- Lighting conditions
- Composition details
- Technical quality terms
- Camera/lens simulation (if applicable)

**Structure:**
```
[Main Subject], [Setting/Environment], [Style/Mood], [Lighting], [Technical Details]
```

### Example Prompts

**Landscape:**
```
A breathtaking view of a crystal clear mountain lake during golden hour,
with snow-capped peaks reflecting in the still water, warm orange and
pink clouds in the sky, serene atmosphere, professional landscape
photography, sharp focus, high dynamic range, 8k quality
```

**Business:**
```
Professional diverse business team collaborating in a bright modern
office space, natural window lighting, candid moment of engaged
discussion around a white table, corporate photography style, clean
and contemporary, shallow depth of field, authentic expressions
```

**Food:**
```
Fresh colorful vegetables artfully arranged on a rustic wooden cutting
board, soft natural side lighting, morning kitchen atmosphere, droplets
of water on produce, professional food photography, shallow depth of
field, appetizing and vibrant colors
```

---

## Complete Examples

### Example 1: Landscape

```
[PROMPT START]
Title: Serene Mountain Lake Reflection at Sunset
Keywords: mountain, lake, sunset, reflection, nature, landscape, peaceful, water, scenic, golden hour, tranquil, wilderness, pristine, alpine, peaks
Aspect Ratio: 16:9
===
A breathtaking panoramic view of a pristine alpine lake at golden hour,
perfectly still water creating mirror-like reflections of snow-capped
mountain peaks, warm orange and pink sunset colors painting the sky,
scattered clouds catching the last light, small wooden dock extending
into the water, pine trees framing the scene, professional landscape
photography, exceptional clarity and detail, high dynamic range, 8k
resolution, National Geographic quality
[PROMPT END]
```

### Example 2: Business

```
[PROMPT START]
Title: Diverse Professional Team Collaborating in Modern Office
Keywords: business, team, meeting, office, collaboration, professional, diverse, corporate, teamwork, workplace, modern, discussion, colleagues, success, startup
Aspect Ratio: 3:2
===
A group of five diverse young professionals engaged in an animated
brainstorming session around a sleek white conference table, modern
open-plan office with floor-to-ceiling windows and city view in
background, natural daylight streaming in, casual business attire,
laptops and tablets on table, genuine smiles and engaged expressions,
one person standing at whiteboard with colorful notes, corporate
lifestyle photography, authentic candid moment, shallow depth of field,
warm and inviting atmosphere
[PROMPT END]
```

### Example 3: Food (Portrait)

```
[PROMPT START]
Title: Fresh Organic Summer Berries in Ceramic Bowl
Keywords: berries, strawberry, blueberry, raspberry, fruit, organic, fresh, healthy, food, summer, breakfast, dessert, natural, delicious, colorful
Aspect Ratio: 4:5
===
Close-up overhead view of a rustic ceramic bowl overflowing with fresh
mixed summer berries, plump red strawberries, deep blue blueberries,
and pink raspberries with morning dew droplets, scattered berries and
green mint leaves on weathered wooden table surface, soft natural
morning light from the side, shallow depth of field with creamy bokeh,
professional food photography, appetizing vibrant colors, farm-to-table
aesthetic, 8k detail
[PROMPT END]
```

### Example 4: Technology

```
[PROMPT START]
Title: Futuristic Smart Home Interface Holographic Display
Keywords: technology, smart home, interface, holographic, futuristic, innovation, digital, modern, connected, automation, AI, touch, display, home
Aspect Ratio: 16:9
===
A person's hand interacting with a floating holographic smart home
control interface in a minimalist modern living room, translucent blue
glowing UI elements showing temperature, lighting, and security controls,
soft ambient lighting in the background, clean contemporary furniture,
cyberpunk meets Scandinavian design aesthetic, cinematic lighting with
subtle lens flare, photorealistic rendering, ultra-detailed, 8k quality,
concept art style with realistic textures
[PROMPT END]
```

---

## Parsing Behavior

### What the Extension Does

1. **Detects markers** - Finds `[PROMPT START]` and `[PROMPT END]`
2. **Extracts content** - Gets everything between markers
3. **Parses metadata** - Looks for `Title:`, `Keywords:`, `Aspect Ratio:` lines
4. **Applies settings** - Updates UI with parsed aspect ratio
5. **Strips metadata** - Removes metadata lines before sending to ComfyUI
6. **Sends clean prompt** - Only generation prompt goes to ComfyUI

### What the CSV App Does

1. **Reads PNG metadata** - Extracts embedded workflow JSON
2. **Finds prompt text** - Locates text in supported nodes
3. **Parses headers** - Looks for `Title:` and `Keywords:` before `===`
4. **Pre-fills fields** - Uses parsed data as defaults
5. **Generates missing** - Uses LM Studio for any missing metadata

---

## Migration Notes

### From Old Format

If you have prompts without the new format:

**Old:**
```
A beautiful mountain landscape at sunset with reflection in lake
```

**New:**
```
[PROMPT START]
Title: Mountain Landscape with Lake Reflection at Sunset
Keywords: mountain, landscape, sunset, lake, reflection, nature, scenic
Aspect Ratio: 16:9
===
A beautiful mountain landscape at sunset with reflection in lake,
golden hour lighting, serene atmosphere, professional photography
[PROMPT END]
```

### Backward Compatibility

- Prompts without metadata still work
- Extension uses defaults when metadata missing
- CSV app generates metadata if not pre-filled

---

*See [AI_CHAT_TEMPLATE.txt](./AI_CHAT_TEMPLATE.txt) for copy-paste instructions for AI assistants.*
