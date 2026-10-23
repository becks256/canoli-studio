import type {Document} from '../dom';
import type {HistoryOperation} from '../core/history-provenance';
import {displayHistoryLabel} from '../core/history-inspection';
const surfaces={host:'Trusted host',editor:'Browser editor / host',rest:'Independent REST',script:'Isolated script',plugin:'Installed plugin','connected-client':'Connected client'};
export function HistoryOperationInfo({document,operation,label='Operation provenance'}:{document:Document;operation:HistoryOperation|null|undefined;label?:string}){
 if(!operation)return <p className="field-hint">{label}: not recorded for this state. Older history is not assigned an inferred author or execution time.</p>;
 return <details className="history-operation-info"><summary>{label}: {surfaces[operation.origin.surface]}</summary>
  <p>{document._isHistoryOperationObserved(operation)?'Observed at acceptance in this open document session.':'Stored record: not observed in this open document session and not authenticated.'} This identifies an edit path, not a human author, verified model response or cryptographic attestation.</p>
  <dl><dt>Accepted operation</dt><dd>{displayHistoryLabel(operation.label)}</dd><dt>Operation ID</dt><dd>{operation.id}</dd><dt>Local clock (UTC)</dt><dd>{operation.recordedAt===null?'Unavailable':new Date(operation.recordedAt).toISOString()}</dd><dt>Editing session</dt><dd>{operation.sessionId} · revision {operation.acceptedRevision}</dd><dt>Submitted commands</dt><dd>{operation.commandCount} validated leaf commands; types: {operation.commandTypes.join(', ')||'None'}</dd>
  {operation.origin.executionId&&<><dt>Execution</dt><dd>{operation.origin.executionId}</dd></>}
  {operation.origin.plugin&&<><dt>Plugin command</dt><dd>{operation.origin.plugin.id} · {operation.origin.plugin.version} · {operation.origin.plugin.commandId}</dd></>}
  {operation.origin.requestId&&!operation.origin.connectionId&&<><dt>Host request</dt><dd>{operation.origin.requestId}</dd></>}
  {operation.origin.connectionId&&<><dt>Connection / request</dt><dd>{operation.origin.connectionId} · {operation.origin.requestId??'Not recorded'}</dd></>}
  {operation.origin.batch&&<><dt>Batch run / item</dt><dd>{operation.origin.batch.runId} · {operation.origin.batch.itemId}</dd></>}
  {operation.origin.recipe&&<><dt>Recipe</dt><dd>{operation.origin.recipe.id} · version {operation.origin.recipe.version}</dd></>}
  {operation.origin.candidate&&<><dt>Candidate / job</dt><dd>{operation.origin.candidate.id} · {operation.origin.candidate.jobId}</dd><dt>Provider / model declaration</dt><dd>{operation.origin.candidate.providerId??'Not recorded'} · {operation.origin.candidate.modelVersion??'Not recorded'}</dd></>}
  </dl><p className="field-hint">Session revisions can include metadata changes and reset on reopening. Local clock time can be inaccurate. Imported records can be edited; provenance never reruns an operation or authorizes billing.</p>
 </details>;
}
