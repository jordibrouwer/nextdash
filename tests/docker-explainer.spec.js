// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

// The ℹ beside Tour in the Containers header, as the Bookmarks and Inbox
// views have: it explains the view, and Got it closes it.
test('the ℹ in the Containers header explains the view', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]').first()).toBeVisible();
    const help = page.locator('[data-docker-help]');
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute('aria-label', 'How the Containers view works');
    await help.click();
    const modal = page.locator('#app-modal.show');
    await expect(modal).toContainText('How the Containers view works');
    await expect(modal.locator('.view-explain-row h4')).toHaveText(['The list', 'Acting on containers', 'The side panel', 'Updates', 'Disk']);
    await modal.getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('#app-modal.show')).toHaveCount(0);
    await expect(page).toHaveURL(/#docker$/);
});
