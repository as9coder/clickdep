// Admin configuration
export const ADMIN_CONFIG = {
    email: 'amianadmin@gmail.com',
    // Strong password hash - you'll set the actual password in Firebase
    // Password: ClickDep@Admin2026!
    role: 'admin'
};

export function isAdmin(userEmail: string): boolean {
    return userEmail === ADMIN_CONFIG.email;
}
