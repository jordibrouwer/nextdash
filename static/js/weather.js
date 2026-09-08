class WeatherService {
    constructor() {
        this.weatherCodeMap = {
            0: 'clear',
            1: 'clear',
            2: 'cloudy',
            3: 'cloudy',
            45: 'fog',
            48: 'fog',
            51: 'drizzle',
            53: 'drizzle',
            55: 'drizzle',
            56: 'drizzle',
            57: 'drizzle',
            61: 'rain',
            63: 'rain',
            65: 'rain',
            66: 'rain',
            67: 'rain',
            71: 'snow',
            73: 'snow',
            75: 'snow',
            77: 'snow',
            80: 'rain',
            81: 'rain',
            82: 'rain',
            85: 'snow',
            86: 'snow',
            95: 'thunderstorm',
            96: 'thunderstorm',
            99: 'thunderstorm'
        };
    }

    getCacheKey(settings) {
        const source = settings?.weatherSource || 'manual';
        const unit = settings?.weatherUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
        const location = source === 'manual'
            ? String(settings?.weatherLocation || '').trim().toLowerCase()
            : 'browser';
        return `nextdash-weather-cache:${source}:${unit}:${location}`;
    }

    getCachedWeather(settings) {
        try {
            const raw = localStorage.getItem(this.getCacheKey(settings));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.timestamp || !parsed.data) return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    setCachedWeather(settings, data) {
        try {
            localStorage.setItem(this.getCacheKey(settings), JSON.stringify({
                timestamp: Date.now(),
                data
            }));
        } catch (error) {
            // Ignore cache write failures.
        }
    }

    isCacheValid(cached, settings) {
        if (!cached || !cached.timestamp) return false;
        const refreshMinutes = Number(settings?.weatherRefreshMinutes || 30);
        const safeMinutes = Number.isFinite(refreshMinutes) && refreshMinutes > 0 ? refreshMinutes : 30;
        return (Date.now() - Number(cached.timestamp)) < safeMinutes * 60 * 1000;
    }

    getForecastCacheKey(settings, mode) {
        return `${this.getCacheKey(settings)}:forecast:${mode}`;
    }

    getCachedForecast(settings, mode) {
        try {
            const raw = localStorage.getItem(this.getForecastCacheKey(settings, mode));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.timestamp || !parsed.data) return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    setCachedForecast(settings, mode, data) {
        try {
            localStorage.setItem(this.getForecastCacheKey(settings, mode), JSON.stringify({
                timestamp: Date.now(),
                data
            }));
        } catch (error) {
            // Ignore cache write failures.
        }
    }

    async fetchWeather(settings, options = {}) {
        this.lastFetchError = null;
        const useCache = options.useCache !== false;
        if (useCache) {
            const cached = this.getCachedWeather(settings);
            if (this.isCacheValid(cached, settings)) {
                return cached.data;
            }
        }

        const locationData = settings?.weatherSource === 'browser'
            ? await this.resolveFromBrowser()
            : await this.resolveFromManualLocation(settings?.weatherLocation);
        if (!locationData) {
            if (!this.lastFetchError) {
                this.lastFetchError = settings?.weatherSource === 'browser'
                    ? 'geolocation_failed'
                    : 'manual_location_missing';
            }
            return null;
        }

        const weatherData = await this.fetchCurrentWeather(
            locationData.latitude,
            locationData.longitude,
            settings?.weatherUnit
        );
        if (!weatherData) {
            this.lastFetchError = 'weather_fetch_failed';
            return null;
        }

        const result = {
            locationName: locationData.locationName,
            temperature: weatherData.temperature,
            weatherCode: weatherData.weatherCode,
            unitSymbol: weatherData.unitSymbol
        };
        this.setCachedWeather(settings, result);
        return result;
    }

    async resolveFromManualLocation(locationQuery) {
        const query = String(locationQuery || '').trim();
        if (!query) return null;
        const attempts = this.buildManualLocationAttempts(query);

        for (let i = 0; i < attempts.length; i += 1) {
            const candidate = attempts[i];
            if (!candidate) continue;
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=1&language=en&format=json`;
            const response = await fetch(url);
            if (!response.ok) continue;
            const data = await response.json();
            const first = Array.isArray(data?.results) ? data.results[0] : null;
            if (!first) continue;
            return {
                latitude: Number(first.latitude),
                longitude: Number(first.longitude),
                locationName: first.name || candidate
            };
        }
        return null;
    }

    buildManualLocationAttempts(query) {
        const attempts = [query];
        if (query.includes(',')) {
            attempts.push(query.replace(/,/g, ' '));
            attempts.push(query.split(',')[0].trim());
        }
        const unique = new Set();
        return attempts
            .map((value) => String(value || '').trim())
            .filter((value) => {
                if (!value || unique.has(value.toLowerCase())) return false;
                unique.add(value.toLowerCase());
                return true;
            });
    }

    async resolveFromBrowser() {
        const coords = await this.getBrowserCoordinates();
        if (!coords) {
            if (!this.lastFetchError) {
                this.lastFetchError = this.lastGeolocationError || 'geolocation_failed';
            }
            return null;
        }
        const locationName = await this.reverseGeocode(coords.latitude, coords.longitude);
        return {
            latitude: coords.latitude,
            longitude: coords.longitude,
            locationName: locationName || 'Current location'
        };
    }

    getBrowserCoordinates() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                this.lastGeolocationError = 'geolocation_unavailable';
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.lastGeolocationError = null;
                    resolve({
                        latitude: Number(position.coords.latitude),
                        longitude: Number(position.coords.longitude)
                    });
                },
                (error) => {
                    if (error?.code === 1) {
                        this.lastGeolocationError = 'geolocation_denied';
                    } else if (error?.code === 3) {
                        this.lastGeolocationError = 'geolocation_timeout';
                    } else {
                        this.lastGeolocationError = 'geolocation_unavailable';
                    }
                    resolve(null);
                },
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 10 * 60 * 1000 }
            );
        });
    }

    async reverseGeocode(latitude, longitude) {
        const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&language=en&format=json`;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            const first = Array.isArray(data?.results) ? data.results[0] : null;
            return first?.name || null;
        } catch (error) {
            return null;
        }
    }

    async fetchCurrentWeather(latitude, longitude, unit) {
        const fahrenheit = unit === 'fahrenheit';
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,weather_code&temperature_unit=${fahrenheit ? 'fahrenheit' : 'celsius'}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.current) return null;
        return {
            temperature: Number(data.current.temperature_2m),
            weatherCode: Number(data.current.weather_code),
            unitSymbol: fahrenheit ? 'F' : 'C'
        };
    }

    /** Current conditions plus a forecast, resolved and cached together. */
    async fetchForecast(settings, mode, options = {}) {
        this.lastFetchError = null;
        const safeMode = ['3day', '5day', '24h'].includes(mode) ? mode : '3day';
        const useCache = options.useCache !== false;
        if (useCache) {
            const cached = this.getCachedForecast(settings, safeMode);
            if (this.isCacheValid(cached, settings)) {
                return cached.data;
            }
        }

        const locationData = settings?.weatherSource === 'browser'
            ? await this.resolveFromBrowser()
            : await this.resolveFromManualLocation(settings?.weatherLocation);
        if (!locationData) {
            if (!this.lastFetchError) {
                this.lastFetchError = settings?.weatherSource === 'browser'
                    ? 'geolocation_failed'
                    : 'manual_location_missing';
            }
            return null;
        }

        const forecast = await this.fetchForecastAPI(
            locationData.latitude, locationData.longitude, settings?.weatherUnit, safeMode);
        if (!forecast) {
            this.lastFetchError = 'weather_fetch_failed';
            return null;
        }

        const result = {
            locationName: locationData.locationName,
            current: forecast.current,
            days: forecast.days || null,
            hours: forecast.hours || null
        };
        this.setCachedForecast(settings, safeMode, result);
        return result;
    }

    /**
     * Current conditions and the forecast in one request: Open-Meteo answers
     * both from the same call, so this is one round trip rather than two.
     */
    async fetchForecastAPI(latitude, longitude, unit, mode) {
        const fahrenheit = unit === 'fahrenheit';
        const unitSymbol = fahrenheit ? 'F' : 'C';
        const base = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}`
            + `&longitude=${encodeURIComponent(longitude)}&timezone=auto`
            + `&temperature_unit=${fahrenheit ? 'fahrenheit' : 'celsius'}`
            + `&current=temperature_2m,weather_code`;

        if (mode === '24h') {
            const url = `${base}&hourly=temperature_2m,weather_code&forecast_hours=24`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            if (!data?.current) return null;
            const times = data?.hourly?.time;
            if (!Array.isArray(times)) return null;
            const temps = data.hourly.temperature_2m || [];
            const codes = data.hourly.weather_code || [];
            const hours = [];
            // Every third hour: eight points across the next day rather than
            // twenty-four, which is more than a tile has room to list.
            for (let i = 0; i < times.length; i += 3) {
                hours.push({
                    time: times[i],
                    temperature: Number(temps[i]),
                    weatherCode: Number(codes[i])
                });
            }
            return {
                current: {
                    temperature: Number(data.current.temperature_2m),
                    weatherCode: Number(data.current.weather_code),
                    unitSymbol
                },
                hours
            };
        }

        const days = mode === '5day' ? 5 : 3;
        const url = `${base}&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=${days}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.current) return null;
        const dates = data?.daily?.time;
        if (!Array.isArray(dates)) return null;
        const highs = data.daily.temperature_2m_max || [];
        const lows = data.daily.temperature_2m_min || [];
        const codes = data.daily.weather_code || [];
        return {
            current: {
                temperature: Number(data.current.temperature_2m),
                weatherCode: Number(data.current.weather_code),
                unitSymbol
            },
            days: dates.map((date, i) => ({
                date,
                tempMax: Number(highs[i]),
                tempMin: Number(lows[i]),
                weatherCode: Number(codes[i])
            }))
        };
    }

    getWeatherLabelKey(weatherCode) {
        const code = Number(weatherCode);
        const key = this.weatherCodeMap[code] || 'unknown';
        return `dashboard.weatherCode.${key}`;
    }

    getWeatherType(weatherCode) {
        const code = Number(weatherCode);
        return this.weatherCodeMap[code] || 'unknown';
    }
}

window.WeatherService = WeatherService;
