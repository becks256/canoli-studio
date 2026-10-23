import {createContext, useContext, type ReactNode} from 'react';
import {Palette as PaletteIcon} from 'lucide-react';
export interface PalettePickerRequest {color: string; onChoose(color: string): void}
export const PaletteLibraryContext = createContext<((request: PalettePickerRequest) => void) | null>(null);
/** The app owns the modal so context menus may close without discarding it. */
export function PaletteColorControl({label, value, disabled = false, onChoose, children}: {
  label: string; value: string; disabled?: boolean; onChoose(color: string): void; children: ReactNode;
}) {
  const open = useContext(PaletteLibraryContext);
  return <span className="palette-color-control">{children}{open &&
    <button type="button" className="palette-color-button" aria-label={`Choose ${label.toLowerCase()} from palettes`} title="Choose a saved color" disabled={disabled} onClick={event => {event.preventDefault(); open({color: value, onChoose});}}><PaletteIcon size={15}/></button>
  }</span>;
}
export function PaletteColorInput({label, value, disabled = false, onChange}: {
  label: string; value: string; disabled?: boolean; onChange(color: string): void;
}) {
  return <PaletteColorControl label={label} value={value} disabled={disabled} onChoose={onChange}>
    <input type="color" aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/>
  </PaletteColorControl>;
}
