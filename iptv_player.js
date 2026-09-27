(function () {
    'use me'

    function startPlugin() {
        // Проверяем, готова ли Lampa к работе
        if (window.appready) {
            init();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') init();
            });
        }
    }

    function init() {
        // Ваш код: добавление пунктов меню, обработка событий, вывод уведомлений
        Lampa.Noty.show('Мой плагин успешно загружен!');
    }

    startPlugin();
})();
