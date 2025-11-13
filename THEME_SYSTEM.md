# AI History Parser - Theme System Documentation

This document describes the design system and styling patterns used throughout the application. These patterns can be reused in other projects (e.g., ERP systems) for consistent, modern UI design.

## Core Design Principles

1. **Subtle Borders & Accents**: Use subtle borders with colored left accents instead of full-color backgrounds
2. **Consistent Spacing**: Standardized padding (6px-14px) and gaps (6px-10px)
3. **Smooth Transitions**: All interactive elements use `transition: 'all 0.2s ease'`
4. **Readable Typography**: Clear hierarchy with appropriate font sizes (11px-15px)
5. **Focus States**: Subtle accent borders with soft shadows on focus
6. **Hover States**: Border color changes and subtle background shifts

## Color Palette

### Primary Colors
- **Background Primary**: `var(--background-primary)` - Main content areas
- **Background Secondary**: `var(--background-secondary)` - Elevated panels/cards
- **Background Modifier Border**: `var(--background-modifier-border)` - Subtle borders
- **Background Modifier Hover**: `var(--background-modifier-hover)` - Hover states

### Accent Colors
- **Interactive Accent**: `var(--interactive-accent)` - Primary actions, highlights
- **Text Normal**: `var(--text-normal)` - Primary text
- **Text Muted**: `var(--text-muted)` - Secondary text
- **Text On Accent**: `var(--text-on-accent)` - Text on accent backgrounds

## Component Patterns

### 1. Form Inputs

**Standard Input Pattern:**
```css
padding: '6px 10px'
fontSize: '12px'
border: '1px solid var(--background-modifier-border)'
borderRadius: '6px'
background: 'var(--background-primary)'
color: 'var(--text-normal)'
transition: 'all 0.2s ease'
```

**Focus State:**
```css
outline: 'none'
borderColor: 'var(--interactive-accent)'
boxShadow: '0 0 0 2px rgba(var(--interactive-accent-rgb), 0.1)'
```

**Hover State:**
```css
borderColor: 'var(--background-modifier-border-hover)'
```

### 2. Buttons

**Primary Button:**
```css
padding: '6px 12px'
fontSize: '12px'
background: 'var(--interactive-accent)'
color: 'var(--text-on-accent)'
border: 'none'
borderRadius: '6px'
fontWeight: '500'
transition: 'all 0.2s ease'
```

**Secondary Button:**
```css
padding: '6px 10px'
fontSize: '12px'
background: 'var(--background-secondary)'
color: 'var(--text-normal)'
border: '1px solid var(--background-modifier-border)'
borderRadius: '6px'
transition: 'all 0.2s ease'
```

### 3. Cards/Containers

**Card Pattern:**
```css
padding: '12px'
backgroundColor: 'var(--background-primary)' or 'var(--background-secondary)'
border: '1px solid var(--background-modifier-border)'
borderRadius: '6px' or '8px'
boxShadow: '0 1px 3px rgba(0,0,0,0.06)' or '0 2px 8px rgba(0,0,0,0.08)'
transition: 'all 0.2s ease'
```

**Card with Left Accent (Active State):**
```css
borderLeft: '4px solid var(--interactive-accent)' or custom color
border: '1px solid var(--interactive-accent)' or 'var(--background-modifier-border)'
```

### 4. Badges/Labels

**Badge Pattern:**
```css
padding: '3px 8px' or '4px 10px'
fontSize: '11px'
fontWeight: '500'
borderRadius: '4px' or '12px'
background: 'var(--background-modifier-border)' or accent color
color: 'var(--text-muted)' or 'var(--text-on-accent)'
border: '1px solid [color]30' (optional, with opacity)
```

### 5. Headers/Section Titles

**Section Header:**
```css
fontSize: '14px' or '15px'
fontWeight: '600'
color: 'var(--text-normal)'
marginBottom: '8px' or '10px'
```

**Subsection Header:**
```css
fontSize: '13px'
fontWeight: '600'
color: 'var(--text-normal)'
```

### 6. Select/Dropdown

**Select Pattern:**
```css
padding: '6px 10px'
fontSize: '12px'
fontWeight: '500'
border: '1px solid var(--background-modifier-border)'
borderRadius: '6px'
background: 'var(--background-primary)'
color: 'var(--text-normal)'
cursor: 'pointer'
transition: 'all 0.2s ease'
```

**Select Options (to fix white background):**
```css
select option {
  background: 'var(--background-primary) !important'
  color: 'var(--text-normal) !important'
  padding: '6px 10px'
}
```

### 7. Color Picker

**Color Input Pattern:**
```css
width: '32px'
height: '32px'
padding: '2px'
background: '[color]' or 'var(--background-primary)'
border: '2px solid [color]' or 'var(--interactive-accent)'
borderRadius: '6px'
cursor: 'pointer'
boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
```

**Browser-specific styling:**
```css
.aip-color-picker {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}

.aip-color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.aip-color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}
```

## Layout Patterns

### Full-Height Containers
```css
height: '100%'
minHeight: '100%'
maxHeight: '100%'
display: 'flex'
flexDirection: 'column'
overflow: 'hidden'
```

### Scrollable Content Areas
```css
flex: 1
overflowY: 'auto'
padding: '10px'
```

### Grid Layouts
```css
display: 'grid'
gridTemplateColumns: '[columns]'
gap: '10px' or '0px'
```

## Animation Patterns

### Slide Animations
```css
transform: 'translateX([value])'
transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
opacity: [0-1]
pointerEvents: 'auto' or 'none'
```

### Hover Lift
```css
transform: 'translateY(-1px)'
transition: 'all 0.2s ease'
```

## Typography Scale

- **Large Headers**: 15px-16px, weight 700
- **Section Headers**: 13px-14px, weight 700
- **Body Text**: 12px-13px, weight 500-600
- **Small Text**: 11px-12px, weight 500-600
- **Labels/Badges**: 10px-11px, weight 600

### Text Color Rules
- **Default**: `var(--text-normal)` for most text
- **On Colored Backgrounds**: Use contrast calculation (white or black) based on luminance
- **Muted Text**: `var(--text-muted)` for secondary information
- **On Accent**: `var(--text-on-accent)` for text on accent-colored buttons

## Spacing Scale

- **Tight**: 4px
- **Small**: 6px-8px
- **Medium**: 10px-12px
- **Large**: 14px-16px
- **XLarge**: 20px-24px

## Border Radius Scale

- **Small**: 3px-4px (badges, small elements)
- **Medium**: 6px-8px (inputs, buttons, cards)
- **Large**: 10px-12px (containers, panels)

## Shadow Scale

- **Subtle**: `0 1px 3px rgba(0,0,0,0.06)` - Cards
- **Medium**: `0 2px 8px rgba(0,0,0,0.08)` - Elevated panels
- **Focus**: `0 0 0 2px rgba(var(--interactive-accent-rgb), 0.1)` - Input focus

## Example: Collection Container Pattern

```typescript
// Inactive state (with optional color tint)
{
  padding: '12px',
  backgroundColor: collection.color ? `${collection.color}15` : 'var(--background-primary)',
  border: `1px solid ${collection.color ? `${collection.color}40` : 'var(--background-modifier-border)'}`,
  borderLeft: collection.color ? `4px solid ${collection.color}60` : '1px solid var(--background-modifier-border)',
  borderRadius: '6px',
  color: 'var(--text-normal)',
  transition: 'all 0.2s ease'
}

// Active state (color fills the box)
{
  padding: '12px',
  backgroundColor: collection.color ? collection.color : 'var(--background-secondary)',
  border: `1px solid ${collection.color || 'var(--interactive-accent)'}`,
  borderLeft: `4px solid ${collection.color || 'var(--interactive-accent)'}`,
  borderRadius: '6px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  color: collection.color ? (getContrastColor(collection.color) === 'white' ? '#ffffff' : '#000000') : 'var(--text-normal)',
  transition: 'all 0.2s ease'
}
```

### Contrast Color Helper

```typescript
// Helper to determine text color (white or black) based on background luminance
const getContrastColor = (hexColor: string): 'white' | 'black' => {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'black' : 'white';
};
```

## Usage in Other Projects

To apply this theme system to other projects (e.g., ERP):

1. **Extract CSS Variables**: Define the same CSS variables in your project
2. **Create Component Library**: Build reusable components using these patterns
3. **Apply Consistently**: Use the same spacing, typography, and color scales
4. **Maintain Transitions**: Keep the 0.2s ease transitions for consistency
5. **Document Patterns**: Create a similar style guide for your team

## Key Files

- `src/styles.css` - Global styles and CSS variables
- `src/ui/CollectionPanel.tsx` - Example of card/container patterns
- `src/components/ToolBlock.tsx` - Example of form input patterns
- `src/view.tsx` - Example of layout and button patterns


