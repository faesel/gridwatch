export interface AutoTagRule {
  id: string;      // stable id (crypto.randomUUID) for React keys and removal
  path: string;    // absolute directory; matches this dir and all subdirectories
  tags: string[];  // tags applied to sessions whose gitRoot/cwd falls under path
}
