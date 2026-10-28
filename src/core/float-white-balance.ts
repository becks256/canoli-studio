import{whiteBalanceAdjustmentSchema,whiteBalanceMatrix,WHITE_BALANCE_NEUTRAL,type WhiteBalanceAdjustmentData}from'./white-balance';

/** Private captured linear-RGB stage. Null is an exact identity, avoiding
 * arithmetic changes to signed zero and subnormals in neutral adjustments. */
export function compileFloatWhiteBalance(input:WhiteBalanceAdjustmentData):readonly number[]|null{
 const settings=whiteBalanceAdjustmentSchema.parse(input);
 if(settings.temperature===WHITE_BALANCE_NEUTRAL&&settings.tint===0)return null;
 const values=whiteBalanceMatrix(settings).flatMap(row=>[...row,0]);
 if(!values.every(Number.isFinite))throw new Error('White Balance exceeds float matrix precision.');
 return values;
}
