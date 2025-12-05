const { query } = require('../config/database');
const moment = require('moment');

// 获取系统配置列表
exports.getSystemConfigs = async (req, res) => {
    try {
        const { category, search, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        // 根据分类筛选
        if (category && category !== 'all') {
            whereConditions.push('category = ?');
            params.push(category);
        }

        // 搜索功能
        if (search) {
            whereConditions.push('(config_key LIKE ? OR description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total FROM system_config ${whereClause}`,
            params
        );

        // 获取配置列表
        const configs = await query(
            `SELECT sc.*, au.real_name as updated_by_name
             FROM system_config sc
             LEFT JOIN admin_users au ON sc.updated_by = au.id
             ${whereClause}
             ORDER BY sc.category ASC, sc.config_key ASC
             LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
            params
        );

        res.json({
            success: true,
            data: {
                list: configs,
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('获取系统配置列表错误:', error);
        res.status(500).json({
            success: false,
            message: '获取系统配置列表失败'
        });
    }
};

// 获取系统配置分类
exports.getConfigCategories = async (req, res) => {
    try {
        const categories = await query(
            `SELECT DISTINCT category, 
                    COUNT(*) as config_count,
                    CASE category
                        WHEN 'general' THEN '系统基本'
                        WHEN 'selection' THEN '选课管理'
                        WHEN 'security' THEN '安全设置'
                        WHEN 'notification' THEN '消息通知'
                        WHEN 'limitation' THEN '系统限制'
                        WHEN 'appearance' THEN '外观设置'
                        ELSE category
                    END as category_name
             FROM system_config 
             GROUP BY category 
             ORDER BY category ASC`
        );

        res.json({
            success: true,
            data: categories
        });

    } catch (error) {
        console.error('获取配置分类错误:', error);
        res.status(500).json({
            success: false,
            message: '获取配置分类失败'
        });
    }
};

// 获取单个系统配置
exports.getSystemConfig = async (req, res) => {
    try {
        const { key } = req.params;

        const configs = await query(
            `SELECT sc.*, au.real_name as updated_by_name
             FROM system_config sc
             LEFT JOIN admin_users au ON sc.updated_by = au.id
             WHERE sc.config_key = ?`,
            [key]
        );

        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '系统配置不存在'
            });
        }

        res.json({
            success: true,
            data: configs[0]
        });

    } catch (error) {
        console.error('获取系统配置错误:', error);
        res.status(500).json({
            success: false,
            message: '获取系统配置失败'
        });
    }
};

// 更新系统配置
exports.updateSystemConfig = async (req, res) => {
    try {
        const { key } = req.params;
        const { config_value, description, is_public } = req.body;
        const adminId = req.user.id;

        // 检查配置是否存在
        const existingConfigs = await query(
            'SELECT * FROM system_config WHERE config_key = ?',
            [key]
        );

        if (existingConfigs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '系统配置不存在'
            });
        }

        const oldConfig = existingConfigs[0];

        // 验证配置值格式
        let parsedValue = config_value;
        if (oldConfig.config_type === 'number') {
            const numValue = Number(config_value);
            if (isNaN(numValue)) {
                return res.status(400).json({
                    success: false,
                    message: '配置值必须是数字'
                });
            }
            parsedValue = numValue.toString();
        } else if (oldConfig.config_type === 'boolean') {
            if (!['true', 'false', '1', '0'].includes(config_value.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    message: '配置值必须是布尔值'
                });
            }
            parsedValue = ['true', '1'].includes(config_value.toLowerCase()) ? 'true' : 'false';
        } else if (oldConfig.config_type === 'json') {
            try {
                JSON.parse(config_value);
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    message: '配置值必须是有效的JSON格式'
                });
            }
        }

        // 更新配置
        await query(
            `UPDATE system_config 
             SET config_value = ?, description = ?, is_public = ?, updated_by = ?, updated_at = NOW()
             WHERE config_key = ?`,
            [parsedValue, description, is_public, adminId, key]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, new_data, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'system_config',
                `更新系统配置: ${key}`,
                'system_config',
                null,
                JSON.stringify({ config_value: oldConfig.config_value }),
                JSON.stringify({ config_value: parsedValue }),
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '系统配置更新成功'
        });

    } catch (error) {
        console.error('更新系统配置错误:', error);
        res.status(500).json({
            success: false,
            message: '更新系统配置失败'
        });
    }
};

// 创建系统配置
exports.createSystemConfig = async (req, res) => {
    try {
        const { config_key, config_value, config_type, category, description, is_public } = req.body;
        const adminId = req.user.id;

        // 验证必填字段
        if (!config_key || !config_value || !config_type || !category) {
            return res.status(400).json({
                success: false,
                message: '配置键、配置值、配置类型和分类不能为空'
            });
        }

        // 检查配置键是否已存在
        const existingConfigs = await query(
            'SELECT id FROM system_config WHERE config_key = ?',
            [config_key]
        );

        if (existingConfigs.length > 0) {
            return res.status(400).json({
                success: false,
                message: '配置键已存在'
            });
        }

        // 验证配置类型
        if (!['string', 'number', 'boolean', 'json'].includes(config_type)) {
            return res.status(400).json({
                success: false,
                message: '无效的配置类型'
            });
        }

        // 验证配置值格式
        let parsedValue = config_value;
        if (config_type === 'number') {
            const numValue = Number(config_value);
            if (isNaN(numValue)) {
                return res.status(400).json({
                    success: false,
                    message: '配置值必须是数字'
                });
            }
            parsedValue = numValue.toString();
        } else if (config_type === 'boolean') {
            if (!['true', 'false', '1', '0'].includes(config_value.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    message: '配置值必须是布尔值'
                });
            }
            parsedValue = ['true', '1'].includes(config_value.toLowerCase()) ? 'true' : 'false';
        } else if (config_type === 'json') {
            try {
                JSON.parse(config_value);
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    message: '配置值必须是有效的JSON格式'
                });
            }
        }

        // 创建配置
        const result = await query(
            `INSERT INTO system_config 
             (config_key, config_value, config_type, category, description, is_public, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [config_key, parsedValue, config_type, category, description, is_public, adminId]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'system_config',
                `创建系统配置: ${config_key}`,
                'system_config',
                null,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '系统配置创建成功',
            data: { config_key }
        });

    } catch (error) {
        console.error('创建系统配置错误:', error);
        res.status(500).json({
            success: false,
            message: '创建系统配置失败'
        });
    }
};

// 删除系统配置
exports.deleteSystemConfig = async (req, res) => {
    try {
        const { key } = req.params;
        const adminId = req.user.id;

        // 检查配置是否存在
        const existingConfigs = await query(
            'SELECT * FROM system_config WHERE config_key = ?',
            [key]
        );

        if (existingConfigs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '系统配置不存在'
            });
        }

        // 检查是否为系统关键配置（不允许删除）
        const systemKeys = [
            'system_name', 'max_credits_per_student', 'lottery_processing_time',
            'selection_time_limit', 'max_file_size', 'session_timeout'
        ];

        if (systemKeys.includes(key)) {
            return res.status(400).json({
                success: false,
                message: '系统关键配置不允许删除'
            });
        }

        // 删除配置
        await query('DELETE FROM system_config WHERE config_key = ?', [key]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'delete',
                'system_config',
                `删除系统配置: ${key}`,
                'system_config',
                null,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '系统配置删除成功'
        });

    } catch (error) {
        console.error('删除系统配置错误:', error);
        res.status(500).json({
            success: false,
            message: '删除系统配置失败'
        });
    }
};

// 批量更新系统配置
exports.batchUpdateConfigs = async (req, res) => {
    try {
        const { configs } = req.body;
        const adminId = req.user.id;

        if (!Array.isArray(configs) || configs.length === 0) {
            return res.status(400).json({
                success: false,
                message: '配置数据不能为空'
            });
        }

        // 开始事务
        await query('START TRANSACTION');

        try {
            for (const config of configs) {
                const { config_key, config_value } = config;

                // 获取原配置信息
                const [existingConfig] = await query(
                    'SELECT * FROM system_config WHERE config_key = ?',
                    [config_key]
                );

                if (existingConfig) {
                    // 验证配置值格式
                    let parsedValue = config_value;
                    if (existingConfig.config_type === 'number') {
                        const numValue = Number(config_value);
                        if (isNaN(numValue)) {
                            throw new Error(`配置 ${config_key} 的值必须是数字`);
                        }
                        parsedValue = numValue.toString();
                    } else if (existingConfig.config_type === 'boolean') {
                        if (!['true', 'false', '1', '0'].includes(config_value.toLowerCase())) {
                            throw new Error(`配置 ${config_key} 的值必须是布尔值`);
                        }
                        parsedValue = ['true', '1'].includes(config_value.toLowerCase()) ? 'true' : 'false';
                    } else if (existingConfig.config_type === 'json') {
                        try {
                            JSON.parse(config_value);
                        } catch (e) {
                            throw new Error(`配置 ${config_key} 的值必须是有效的JSON格式`);
                        }
                    }

                    // 更新配置
                    await query(
                        `UPDATE system_config 
                         SET config_value = ?, updated_by = ?, updated_at = NOW()
                         WHERE config_key = ?`,
                        [parsedValue, adminId, config_key]
                    );
                }
            }

            await query('COMMIT');

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'batch_update',
                    'system_config',
                    `批量更新系统配置 (${configs.length}项)`,
                    'system_config',
                    null,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            res.json({
                success: true,
                message: '系统配置批量更新成功'
            });

        } catch (error) {
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('批量更新系统配置错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '批量更新系统配置失败'
        });
    }
};

// 重置配置到默认值
exports.resetConfigToDefault = async (req, res) => {
    try {
        const { key } = req.params;
        const adminId = req.user.id;

        // 默认配置值映射
        const defaultConfigs = {
            'system_name': '体育选课系统',
            'max_credits_per_student': '4',
            'selection_time_limit': '300',
            'max_file_size': '10485760',
            'session_timeout': '3600',
            'allow_course_drop': 'true',
            'allow_course_change': 'true',
            'notification_enabled': 'true',
            'email_enabled': 'false',
            'sms_enabled': 'false'
        };

        if (!defaultConfigs.hasOwnProperty(key)) {
            return res.status(400).json({
                success: false,
                message: '该配置没有默认值'
            });
        }

        // 检查配置是否存在
        const existingConfigs = await query(
            'SELECT * FROM system_config WHERE config_key = ?',
            [key]
        );

        if (existingConfigs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '系统配置不存在'
            });
        }

        // 重置配置
        await query(
            `UPDATE system_config 
             SET config_value = ?, updated_by = ?, updated_at = NOW()
             WHERE config_key = ?`,
            [defaultConfigs[key], adminId, key]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'reset',
                'system_config',
                `重置系统配置到默认值: ${key}`,
                'system_config',
                null,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '系统配置已重置为默认值'
        });

    } catch (error) {
        console.error('重置系统配置错误:', error);
        res.status(500).json({
            success: false,
            message: '重置系统配置失败'
        });
    }
};
