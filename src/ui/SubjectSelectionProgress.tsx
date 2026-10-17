import {Dialog} from './Dialog';
import {Button} from './controls';
import type {SelectionModificationProgress} from '../core/selection-modification';

export function SubjectSelectionProgress({progress,onCancel,title='Select Subject',description="Finding contrast in the selected raster's original pixels…"}:{progress:SelectionModificationProgress;onCancel():void;title?:string;description?:string}){
  return <Dialog titleId="subject-selection-title" onClose={onCancel}>
    <div className="dialog-heading"><h2 id="subject-selection-title">{title}</h2></div>
    <p className="script-description">{description}</p>
    <div role="status"><progress aria-label={title==='Select Subject'?'Subject selection progress':`${title} progress`} max={progress.total} value={progress.completed}/></div>
    <div className="artboard-actions"><Button onClick={onCancel}>Cancel {title}</Button></div>
  </Dialog>;
}
