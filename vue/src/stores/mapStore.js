/**
 * @file mapStore.js
 * @description (新文件)
 *              一个用于管理世界地图功能的 Pinia Store。
 *              负责获取、存储和添加地理位置标记点。
 * @module Stores
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiService } from '@/services/apiService';
import { eventBus } from '@/services/eventBus';
import { log } from '@/utils';

export const useMapStore = defineStore('map', () => {
    // --- STATE ---
    const locations = ref([]);
    const isLoading = ref(false);

    // --- ACTIONS ---

    /**
     * 从后端API获取所有共享的地点标记。
     */
    async function fetchLocations() {
        if (isLoading.value) return;
        isLoading.value = true;
        try {
            const fetchedLocations = await apiService.getMapLocations();
            locations.value = fetchedLocations;
            log(`成功获取 ${fetchedLocations.length} 个地图标记点。`, 'INFO');
        } finally {
            isLoading.value = false;
        }
    }

    /**
     * 添加一个新的地点标记。
     * @param {object} locationData - 包含新地点信息的对象。
     * @returns {Promise<boolean>} 操作是否成功。
     */
    async function addLocation(locationData) {
        isLoading.value = true;
        try {
            const newLocation = await apiService.createMapLocation(locationData);
            if (newLocation) {
                locations.value.push(newLocation);
                eventBus.emit('showNotification', { message: '地点分享成功！', type: 'success' });
                return true;
            }
            return false;
        } finally {
            isLoading.value = false;
        }
    }

    return {
        locations,
        isLoading,
        fetchLocations,
        addLocation,
    };
});