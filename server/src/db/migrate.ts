// Migration: Add user_id column to projects
import { db } from './schema';

try {
    // Check if column exists
    const tableInfo = db.query("PRAGMA table_info(projects)").all() as any[];
    const hasUserId = tableInfo.some((col: any) => col.name === 'user_id');

    if (!hasUserId) {
        console.log('[Migration] Adding user_id column to projects table...');
        db.run('ALTER TABLE projects ADD COLUMN user_id TEXT');
        console.log('[Migration] user_id column added successfully');
    } else {
        console.log('[Migration] user_id column already exists');
    }
} catch (err) {
    console.error('[Migration] Error:', err);
}
