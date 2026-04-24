export interface AllowedDirectory {
  path: string
  addedAt: string  // ISO date string
  exists: boolean  // whether the directory currently exists on disk
}
