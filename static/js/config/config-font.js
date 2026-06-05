// Config Font — custom font upload and application in config preview
class ConfigFont {
    constructor() {
        this.waitForSettings();
    }

    waitForSettings() {
        const check = () => {
            if (window.ConfigManager && window.ConfigManager.settingsData) {
                this.loadCurrentFont();
            } else {
                setTimeout(check, 50);
            }
        };
        check();
    }

    loadCurrentFont() {
        const settings = window.ConfigManager.settingsData;
        if (window.DashboardFont && typeof window.DashboardFont.applyMainFont === 'function') {
            window.DashboardFont.applyMainFont(settings);
        }
    }

    applyFont(fontPath) {
        if (!fontPath) return;
        if (window.DashboardFont && typeof window.DashboardFont.applyCustomFontFile === 'function') {
            window.DashboardFont.applyCustomFontFile(fontPath);
            return;
        }
        const fontName = 'CustomFont';
        const fontFace = new FontFace(fontName, `url(${fontPath}?t=${Date.now()})`);
        fontFace.load().then((loadedFace) => {
            document.fonts.add(loadedFace);
            document.documentElement.style.setProperty('--font-family-main', `'${fontName}', monospace`);
            document.documentElement.setAttribute('data-font-preset', 'custom');
        }).catch((error) => {
            console.error('Error loading custom font:', error);
        });
    }

    async uploadFont(file) {
        const formData = new FormData();
        formData.append('font', file);

        const response = await fetch('/api/font', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Failed to upload font');
        }

        const result = await response.json();
        return result.path;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.ConfigFont = new ConfigFont();
});
