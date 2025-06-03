
const EventEmitter = {
    events: {},

    on: function (event, callback) {
        if (!this.events[event]) {
            this.events[event] = new Set();
        }
        this.events[event].add(callback);
        Utils.log(`Event listener added for: ${event}`, Utils.logLevels.DEBUG);
    },

    emit: function (event, ...args) {
        if (this.events[event]) {
            Utils.log(`Emitting event: ${event} with args: ${JSON.stringify(args)}`, Utils.logLevels.DEBUG);
            this.events[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (e) {
                    Utils.log(`Error in event listener for ${event}: ${e.message}\n${e.stack}`, Utils.logLevels.ERROR);
                }
            });
        } else {
            // Utils.log(`No listeners for event: ${event}`, Utils.logLevels.DEBUG);
        }
    },

    off: function (event, callback) {
        if (this.events[event]) {
            if (callback) {
                this.events[event].delete(callback);
                Utils.log(`Specific event listener removed for: ${event}`, Utils.logLevels.DEBUG);
            } else {
                delete this.events[event];
                Utils.log(`All event listeners removed for: ${event}`, Utils.logLevels.DEBUG);
            }
        }
    },

    once: function(event, callback) {
        const onceCallback = (...args) => {
            this.off(event, onceCallback);
            callback(...args);
        };
        this.on(event, onceCallback);
    }
};