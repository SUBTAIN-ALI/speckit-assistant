# Ticket 09: Expanded/Resizable Chat Modal

**Priority:** P1  
**Depends On:** Ticket 08  
**Requirements Ref:** Section 8.1  
**Estimated Effort:** Small  

## Description

Add an expand/collapse toggle to the ChatPanel that opens it as a larger modal overlay. Both the side panel and expanded view share the same conversation — no separate state.

The expanded modal is a wrapper around the existing `ChatPanel` component, rendered as a centered overlay with a larger viewport. The side panel remains the default; the expanded view is for longer discussions, detailed evidence review, and knowledge approval previews.

## Files to Create

### `src/chatbot/components/ChatExpandedModal.tsx`

```typescript
type Props = {
  open: boolean;
  onClose: () => void;
};
```

- Renders a modal overlay (fixed position, z-50, backdrop blur)
- Contains `ChatPanel` with `expanded={true}`
- Close button (X) in top-right corner + Escape key closes
- Responsive: on desktop, takes ~80% viewport width and ~90% height, max-width 900px
- On mobile: full-screen
- Transition: fade-in/slide-up animation

### Modifications to `ChatPanel`

- Add an expand button (icon: `Maximize2` from lucide-react) in the header area
- When `expanded={true}`, the panel renders with more vertical space and wider message area
- The expand button in side-panel mode opens the modal; in expanded mode, it shows a minimize icon that closes the modal

### Modifications to host `page.tsx`

- Add state: `const [chatExpanded, setChatExpanded] = useState(false)`
- Render `ChatExpandedModal` alongside the main layout
- Pass `onExpandToggle` to `ChatPanel`

## Acceptance Criteria

- [ ] Expand button visible in ChatPanel header
- [ ] Clicking expand opens `ChatExpandedModal` overlay
- [ ] Expanded modal shows the same conversation (shared state)
- [ ] Escape key or close button closes modal
- [ ] Responsive: full-screen on mobile, centered on desktop
- [ ] Smooth open/close animation

## Test Cases

### `src/chatbot/components/__tests__/ChatExpandedModal.test.tsx`

```typescript
describe('ChatExpandedModal', () => {
  // T09-1: Modal renders when open=true
  it('renders modal overlay when open', () => {
    render(<ChatExpandedModal open={true} onClose={jest.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // T09-2: Modal hidden when open=false
  it('does not render when closed', () => {
    render(<ChatExpandedModal open={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // T09-3: Escape closes modal
  it('calls onClose when Escape pressed', () => {
    const onClose = jest.fn();
    render(<ChatExpandedModal open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // T09-4: Close button works
  it('calls onClose when close button clicked', () => {
    const onClose = jest.fn();
    render(<ChatExpandedModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTitle(/close/i));
    expect(onClose).toHaveBeenCalled();
  });

  // T09-5: Backdrop click closes modal
  it('calls onClose when backdrop clicked', () => {
    const onClose = jest.fn();
    render(<ChatExpandedModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });
});
```
