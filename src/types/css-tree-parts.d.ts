// The maintained declarations cover the aggregate entry; these declarations
// preserve its exact signatures for the package's supported smaller entries.
declare module 'css-tree/parser' {
 const parse:typeof import('css-tree').parse;
 export default parse;
}
declare module 'css-tree/walker' {
 const walk:typeof import('css-tree').walk;
 export default walk;
}
declare module 'css-tree/generator' {
 const generate:typeof import('css-tree').generate;
 export default generate;
}
declare module 'css-tree/utils' {
 export const ident:typeof import('css-tree').ident;
}
