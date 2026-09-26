// Wrangler's Text rule and the vitest plugin both load these as a default string. POST
// /create-test-suite-run fills the ticket from the same files ./ctrl reads.
declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}
