/* ==========================================================================
 * Custom M3U Plugin for Lampa
 * Универсальный плеер M3U/M3U8 плейлистов для Lampa (Media Station X)
 * ==========================================================================
 *
 * Возможности:
 *  - Загрузка и парсинг стандартного M3U/M3U8 плейлиста по URL
 *  - Отрисовка сетки каналов с логотипами (управление с пульта)
 *  - Воспроизведение через встроенный плеер Lampa
 *
 * Установка: подключить этот файл как расширение в настройках Lampa
 * ========================================================================== */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Константы
    // ------------------------------------------------------------------

    // Публичный демо-плейлист (открытый проект iptv-org, свободные каналы).
    // Пользователь может заменить на свой собственный URL плейлиста.
    var DEFAULT_PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';

    var PLUGIN_COMPONENT = 'custom_m3u_plugin';
    var STORAGE_KEY = 'custom_m3u_playlist_url';

    // ------------------------------------------------------------------
    // Вспомогательные функции
    // ------------------------------------------------------------------

    function getPlaylistUrl() {
        try {
            return Lampa.Storage.get(STORAGE_KEY, DEFAULT_PLAYLIST_URL) || DEFAULT_PLAYLIST_URL;
        } catch (e) {
            return DEFAULT_PLAYLIST_URL;
        }
    }

    function setPlaylistUrl(url) {
        try {
            Lampa.Storage.set(STORAGE_KEY, url);
        } catch (e) {}
    }

    /**
     * Парсер стандартного M3U/M3U8 формата.
     * Ожидаемый формат строк:
     *   #EXTM3U
     *   #EXTINF:-1 tvg-id="..." tvg-logo="http://..." group-title="...",Channel Name
     *   http://example.com/stream.m3u8
     *
     * @param {string} text - сырое содержимое m3u файла
     * @returns {Array<{title:string, logo:string, url:string, group:string}>}
     */
    function parseM3U(text) {
        var channels = [];
        if (!text || typeof text !== 'string') return channels;

        // Нормализуем переносы строк и разбиваем на массив
        var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        var current = null;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();

            if (!line) continue;

            if (line.indexOf('#EXTM3U') === 0) {
                continue;
            }

            if (line.indexOf('#EXTINF') === 0) {
                current = {
                    title: '',
                    logo: '',
                    group: '',
                    url: ''
                };

                // Извлекаем название канала (после последней запятой в строке EXTINF)
                var commaIndex = line.lastIndexOf(',');
                if (commaIndex !== -1) {
                    current.title = line.substring(commaIndex + 1).trim();
                }

                // Извлекаем tvg-logo="..."
                var logoMatch = line.match(/tvg-logo="([^"]*)"/i);
                if (logoMatch && logoMatch[1]) {
                    current.logo = logoMatch[1];
                }

                // Извлекаем group-title="..."
                var groupMatch = line.match(/group-title="([^"]*)"/i);
                if (groupMatch && groupMatch[1]) {
                    current.group = groupMatch[1];
                }

                continue;
            }

            // Пропускаем прочие служебные теги (#EXTGRP, #EXTVLCOPT и т.д.)
            if (line.indexOf('#') === 0) {
                continue;
            }

            // Если это не комментарий и не пусто — это URL потока
            if (current) {
                current.url = line;

                if (!current.title) {
                    current.title = 'Канал ' + (channels.length + 1);
                }

                channels.push(current);
                current = null;
            }
        }

        return channels;
    }

    /**
     * Загрузка плейлиста по URL с использованием сетевого модуля Lampa,
     * с фолбэком на стандартный fetch, если Lampa.Reguest недоступен.
     */
    function loadPlaylist(url, onSuccess, onError) {
        var handledByLampa = false;

        try {
            if (typeof Lampa.Reguest === 'function') {
                handledByLampa = true;
                var network = new Lampa.Reguest();

                network.timeout(15000);

                network.native(
                    url,
                    function (response) {
                        // Ответ может прийти как строка либо как объект
                        var text = typeof response === 'string' ? response : (response && response.text) || '';
                        if (!text) {
                            onError('empty_response');
                            return;
                        }
                        onSuccess(text);
                    },
                    function () {
                        onError('network_error');
                    },
                    false,
                    { dataType: 'text' }
                );
            }
        } catch (e) {
            handledByLampa = false;
        }

        if (!handledByLampa) {
            // Фолбэк на fetch, если Lampa.Reguest недоступен в среде
            fetch(url)
                .then(function (resp) {
                    if (!resp.ok) throw new Error('bad_status');
                    return resp.text();
                })
                .then(function (text) {
                    onSuccess(text);
                })
                .catch(function () {
                    onError('network_error');
                });
        }
    }

    // ------------------------------------------------------------------
    // SVG иконка TV для меню
    // ------------------------------------------------------------------

    var tvIconSvg =
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M21 3H3C1.9 3 1 3.9 1 5V17C1 18.1 1.9 19 3 19H8L7 21V22H17V21L16 19H21C22.1 19 23 18.1 23 17V5C23 3.9 22.1 3 21 3ZM21 17H3V5H21V17Z" fill="currentColor"/>' +
        '<path d="M12 6.5L17 9.5L12 12.5V6.5Z" fill="currentColor"/>' +
        '</svg>';

    // ------------------------------------------------------------------
    // Компонент интерфейса плагина
    // ------------------------------------------------------------------

    function ComponentM3U(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="custom-m3u"></div>');
        var body = $('<div class="custom-m3u__body"></div>');
        var loadingShown = false;

        var channels = [];

        this.create = function () {
            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectSet(body, html);
                    Lampa.Controller.clear();
                    Lampa.Controller.enable('content');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    Navigator.move('right');
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    Navigator.move('down');
                },
                back: this.back.bind(this)
            });

            Lampa.Controller.toggle('content');

            this.load();
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.showLoading = function () {
            if (loadingShown) return;
            loadingShown = true;
            Lampa.Activity.active().loader(true);
        };

        this.hideLoading = function () {
            loadingShown = false;
            Lampa.Activity.active().loader(false);
        };

        this.load = function () {
            var self = this;
            var url = getPlaylistUrl();

            this.showLoading();

            loadPlaylist(
                url,
                function (text) {
                    self.hideLoading();

                    var parsed = parseM3U(text);

                    if (!parsed.length) {
                        Lampa.Noty.show('Плейлист пуст или имеет неверный формат');
                        self.empty();
                        return;
                    }

                    channels = parsed;
                    self.buildList(parsed);
                },
                function () {
                    self.hideLoading();
                    Lampa.Noty.show('Ошибка загрузки плейлиста M3U');
                    self.empty();
                }
            );
        };

        this.empty = function () {
            var empty = new Lampa.Empty({
                title: 'Не удалось загрузить каналы',
                description: 'Проверьте подключение к интернету или ссылку на плейлист'
            });
            body.empty().append(empty.render());
            html.append(body);
            scroll.minus();
        };

        this.buildList = function (list) {
            body.empty();

            var itemsWrap = $('<div class="custom-m3u__grid"></div>');

            list.forEach(function (channel, index) {
                var card = buildCard(channel, index);
                itemsWrap.append(card);
            });

            body.append(itemsWrap);
            scroll.body().append(body);
            html.append(scroll.render());

            scroll.onEnd = function () {};

            Lampa.Controller.collectSet(body, html);
            Lampa.Controller.toggle('content');
        };

        function buildCard(channel, index) {
            var card = $(
                '<div class="custom-m3u__card selector" data-index="' + index + '">' +
                    '<div class="custom-m3u__logo">' +
                        (channel.logo
                            ? '<img src="' + Lampa.Utils.escapeHtml(channel.logo) + '" onerror="this.style.display=\'none\'"/>'
                            : '<div class="custom-m3u__logo-placeholder">TV</div>') +
                    '</div>' +
                    '<div class="custom-m3u__title">' + Lampa.Utils.escapeHtml(channel.title) + '</div>' +
                '</div>'
            );

            card.on('hover:enter', function () {
                playChannel(index);
            });

            card.on('hover:focus', function () {
                scroll.update(card, true);
            });

            return card;
        }

        function playChannel(index) {
            var channel = channels[index];
            if (!channel || !channel.url) {
                Lampa.Noty.show('У этого канала нет доступного потока');
                return;
            }

            var playlist = channels
                .filter(function (c) {
                    return !!c.url;
                })
                .map(function (c) {
                    return {
                        title: c.title,
                        url: c.url,
                        logo: c.logo
                    };
                });

            var playIndex = 0;
            for (var i = 0; i < playlist.length; i++) {
                if (playlist[i].url === channel.url && playlist[i].title === channel.title) {
                    playIndex = i;
                    break;
                }
            }

            Lampa.Player.playlist(playlist);

            Lampa.Player.play({
                title: channel.title,
                url: channel.url
            });

            Lampa.Player.open({
                title: channel.title,
                url: channel.url,
                playIndex: playIndex
            });
        }

        this.destroy = function () {
            scroll.destroy();
            html.remove();
            body.remove();
        };
    }

    // ------------------------------------------------------------------
    // Стили плагина
    // ------------------------------------------------------------------

    function injectStyles() {
        var style = document.createElement('style');
        style.innerHTML =
            '.custom-m3u__body { padding: 1em; }' +
            '.custom-m3u__grid { display: flex; flex-wrap: wrap; gap: 1.2em; padding: 1em; }' +
            '.custom-m3u__card { width: 220px; height: 140px; background: rgba(255,255,255,0.05); border-radius: 12px; ' +
                'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1em; ' +
                'transition: all .2s ease; cursor: pointer; box-sizing: border-box; }' +
            '.custom-m3u__card.focus { background: rgba(255,255,255,0.9); color: #000; transform: scale(1.05); }' +
            '.custom-m3u__logo { width: 90px; height: 60px; display: flex; align-items: center; justify-content: center; margin-bottom: .6em; }' +
            '.custom-m3u__logo img { max-width: 100%; max-height: 100%; object-fit: contain; }' +
            '.custom-m3u__logo-placeholder { font-size: 1.4em; font-weight: bold; opacity: .6; }' +
            '.custom-m3u__title { text-align: center; font-size: 1em; overflow: hidden; text-overflow: ellipsis; ' +
                'white-space: nowrap; width: 100%; }';
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // Регистрация плагина
    // ------------------------------------------------------------------

    function initPlugin() {
        injectStyles();

        Lampa.Component.add(PLUGIN_COMPONENT, ComponentM3U);

        Lampa.Menu.add({
            title: 'M3U Player',
            subtitle: 'Плейлист телеканалов',
            icon: tvIconSvg,
            action: function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'M3U Player',
                    component: PLUGIN_COMPONENT,
                    page: 1
                });
            }
        });

        // Добавляем пункт в настройки для смены URL плейлиста
        try {
            Lampa.SettingsApi.addComponent({
                component: 'custom_m3u_settings',
                name: 'M3U Player',
                icon: tvIconSvg
            });

            Lampa.SettingsApi.addParam({
                component: 'custom_m3u_settings',
                param: {
                    name: STORAGE_KEY,
                    type: 'input',
                    'default': DEFAULT_PLAYLIST_URL
                },
                field: {
                    name: 'Ссылка на M3U плейлист',
                    description: 'Прямая ссылка на .m3u/.m3u8 файл'
                },
                onChange: function (value) {
                    setPlaylistUrl(value);
                }
            });
        } catch (e) {
            // SettingsApi может отличаться между версиями Lampa — не критично
        }
    }

    // ------------------------------------------------------------------
    // Точка входа
    // ------------------------------------------------------------------

    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') {
                initPlugin();
            }
        });
    }
})();
