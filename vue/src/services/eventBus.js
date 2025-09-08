import { log } from '@/utils';

const events = new Map();

/**
 * A simple event bus for decoupled communication between modules.
 * Useful for global events like notifications or actions that cross multiple stores.
 */
export const eventBus = {
    /**
     * Register an event listener.
     * @param {string} event - The event name.
     * @param {Function} callback - The callback function.
     */
    on(event, callback) {
        if (!events.has(event)) {
            events.set(event, new Set());
        }
        events.get(event).add(callback);
        log(`Event listener added: ${event}`, 'DEBUG');
    },

    /**
     * Trigger an event.
     * @param {string} event - The event name.
     * @param {...*} args - Arguments to pass to the listeners.
     */
    emit(event, ...args) {
        if (events.has(event)) {
            log(`Emitting event: ${event} with args: ${JSON.stringify(args)}`, 'DEBUG');
            events.get(event).forEach(callback => {
                try {
                    // Make a copy of args for each listener to prevent mutation issues
                    callback(...JSON.parse(JSON.stringify(args)));
                } catch (e) {
                    log(`Error in event listener for ${event}: ${e.message}`, 'ERROR');
                }
            });
        }
    },

    /**
     * Remove an event listener.
     * @param {string} event - The event name.
     * @param {Function} [callback] - The specific callback to remove. If omitted, all listeners for the event are removed.
     */
    off(event, callback) {
        if (!events.has(event)) return;

        if (callback) {
            events.get(event).delete(callback);
        } else {
            events.delete(event);
        }
        log(`Event listener removed: ${event}`, 'DEBUG');
    }
};