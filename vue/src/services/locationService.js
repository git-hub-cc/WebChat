/**
 * @file locationService.js
 * @description (Vue Refactor - NEW FILE)
 *              封装浏览器 Geolocation API，用于获取用户当前地理位置。
 *              此服务不依赖任何第三方API Key。
 * @module Services
 */
import { log } from '@/utils';

export const locationService = {
    /**
     * 获取用户当前的地理位置坐标。
     * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
     *          一个解析为包含经纬度和精度对象的 Promise。
     *          如果失败，则会 reject 一个包含错误信息的 Error 对象。
     */
    getCurrentLocation() {
        return new Promise((resolve, reject) => {
            // 安全检查：Geolocation API 多数情况下需要 HTTPS 或 localhost 环境
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                const errorMsg = '出于安全原因，获取地理位置需要 HTTPS 连接。';
                log(errorMsg, 'WARN');
                reject(new Error(errorMsg));
                return;
            }

            if (!navigator.geolocation) {
                const errorMsg = '您的浏览器不支持地理位置功能。';
                log(errorMsg, 'ERROR');
                reject(new Error(errorMsg));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                // 成功回调
                (position) => {
                    const { latitude, longitude, accuracy } = position.coords;
                    log(`成功获取地理位置: Lat=${latitude}, Lon=${longitude}, Accuracy=${accuracy}m`, 'INFO');
                    resolve({ latitude, longitude, accuracy });
                },
                // 失败回调
                (error) => {
                    let errorMessage = '获取地理位置失败。';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = '您已拒绝共享位置信息。';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = '无法确定您的位置。';
                            break;
                        case error.TIMEOUT:
                            errorMessage = '获取位置信息超时。';
                            break;
                        default:
                            errorMessage = `发生未知错误 (代码: ${error.code})。`;
                            break;
                    }
                    log(`地理位置错误: ${errorMessage}`, 'ERROR');
                    reject(new Error(errorMessage));
                },
                // 选项
                {
                    enableHighAccuracy: true,
                    timeout: 10000, // 10秒超时
                    maximumAge: 0,   // 不使用缓存
                }
            );
        });
    }
};