const { query } = require('../config/database');
const moment = require('moment');

// 获取选课配置列表
exports.getSelectionConfigs = async (req, res) => {
    try {
        const { page = 1, limit = 10, semester, academic_year, status } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (semester) {
            whereConditions.push('csc.semester = ?');
            params.push(semester);
        }

        if (academic_year) {
            whereConditions.push('csc.academic_year = ?');
            params.push(academic_year);
        }

        if (status) {
            whereConditions.push('csc.status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total FROM course_selection_config csc ${whereClause}`,
            params
        );

        // 获取配置列表
        const configs = await query(
            `SELECT csc.*, au.real_name as creator_name
             FROM course_selection_config csc
             LEFT JOIN admin_users au ON csc.created_by = au.id
             ${whereClause}
             ORDER BY csc.academic_year DESC, csc.semester DESC, csc.round_number ASC
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
        console.error('获取选课配置列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取选课配置详情
exports.getSelectionConfig = async (req, res) => {
    try {
        const { id } = req.params;

        const configs = await query(
            `SELECT csc.*, au.real_name as creator_name
             FROM course_selection_config csc
             LEFT JOIN admin_users au ON csc.created_by = au.id
             WHERE csc.id = ?`,
            [id]
        );

        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '选课配置不存在'
            });
        }

        res.json({
            success: true,
            data: configs[0]
        });

    } catch (error) {
        console.error('获取选课配置详情错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 创建选课配置
exports.createSelectionConfig = async (req, res) => {
    try {
        const {
            semester,
            academic_year,
            round_number,
            round_name,
            selection_method,
            start_time,
            end_time,
            max_credits,
            max_courses,
            allow_drop,
            allow_change,
            priority_rules,
            lottery_config,
            description
        } = req.body;

        const adminId = req.user.id;

        // 验证必填字段
        if (!semester || !academic_year || !round_number || !round_name || !selection_method || !start_time || !end_time) {
            return res.status(400).json({
                success: false,
                message: '学期、学年、轮次、选课方式和时间不能为空'
            });
        }

        // 验证时间逻辑
        if (moment(start_time).isAfter(moment(end_time))) {
            return res.status(400).json({
                success: false,
                message: '开始时间不能晚于结束时间'
            });
        }

        // 检查是否存在重复的配置
        const existingConfigs = await query(
            'SELECT id FROM course_selection_config WHERE semester = ? AND academic_year = ? AND round_number = ?',
            [semester, academic_year, round_number]
        );

        if (existingConfigs.length > 0) {
            return res.status(400).json({
                success: false,
                message: '该学期轮次的选课配置已存在'
            });
        }

        // 检查时间冲突
        const conflictConfigs = await query(
            `SELECT id FROM course_selection_config 
             WHERE semester = ? AND academic_year = ? 
             AND ((start_time <= ? AND end_time >= ?) OR (start_time <= ? AND end_time >= ?))
             AND status != 'cancelled'`,
            [semester, academic_year, start_time, start_time, end_time, end_time]
        );

        if (conflictConfigs.length > 0) {
            return res.status(400).json({
                success: false,
                message: '选课时间与其他配置存在冲突'
            });
        }

        // 创建选课配置
        const result = await query(
            `INSERT INTO course_selection_config 
             (semester, academic_year, round_number, round_name, selection_method, start_time, end_time, 
              max_credits, max_courses, allow_drop, allow_change, priority_rules, lottery_config, description, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                semester, academic_year, round_number, round_name, selection_method, start_time, end_time,
                max_credits || 2, max_courses || 1, allow_drop !== false, allow_change !== false,
                JSON.stringify(priority_rules || {}), JSON.stringify(lottery_config || {}), description, adminId
            ]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'selection_config',
                `创建选课配置: ${academic_year}学年${semester}学期第${round_number}轮`,
                'selection_config',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '选课配置创建成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('创建选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新选课配置
exports.updateSelectionConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            round_name,
            selection_method,
            start_time,
            end_time,
            max_credits,
            max_courses,
            allow_drop,
            allow_change,
            priority_rules,
            lottery_config,
            description,
            status
        } = req.body;

        const adminId = req.user.id;

        // 检查配置是否存在
        const existingConfigs = await query(
            'SELECT * FROM course_selection_config WHERE id = ?',
            [id]
        );

        if (existingConfigs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '选课配置不存在'
            });
        }

        const oldConfig = existingConfigs[0];

        // 如果配置已激活，限制某些字段的修改
        if (oldConfig.status === 'active') {
            // 只允许修改描述、状态和部分规则
            await query(
                `UPDATE course_selection_config 
                 SET description = ?, status = ?, priority_rules = ?, lottery_config = ?, updated_at = NOW()
                 WHERE id = ?`,
                [description, status, JSON.stringify(priority_rules || {}), JSON.stringify(lottery_config || {}), id]
            );
        } else {
            // 验证时间逻辑
            if (start_time && end_time && moment(start_time).isAfter(moment(end_time))) {
                return res.status(400).json({
                    success: false,
                    message: '开始时间不能晚于结束时间'
                });
            }

            // 更新所有字段
            await query(
                `UPDATE course_selection_config 
                 SET round_name = ?, selection_method = ?, start_time = ?, end_time = ?, 
                     max_credits = ?, max_courses = ?, allow_drop = ?, allow_change = ?,
                     priority_rules = ?, lottery_config = ?, description = ?, status = ?, updated_at = NOW()
                 WHERE id = ?`,
                [
                    round_name, selection_method, start_time, end_time,
                    max_credits, max_courses, allow_drop, allow_change,
                    JSON.stringify(priority_rules || {}), JSON.stringify(lottery_config || {}),
                    description, status, id
                ]
            );
        }

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, new_data, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'selection_config',
                `更新选课配置: ${oldConfig.academic_year}学年${oldConfig.semester}学期第${oldConfig.round_number}轮`,
                'selection_config',
                id,
                JSON.stringify({ status: oldConfig.status, description: oldConfig.description }),
                JSON.stringify({ status, description }),
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '选课配置更新成功'
        });

    } catch (error) {
        console.error('更新选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 激活选课配置
exports.activateSelectionConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查配置是否存在
        const configs = await query(
            'SELECT * FROM course_selection_config WHERE id = ?',
            [id]
        );

        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '选课配置不存在'
            });
        }

        const config = configs[0];

        // 检查是否有其他激活的配置
        const activeConfigs = await query(
            `SELECT id FROM course_selection_config 
             WHERE semester = ? AND academic_year = ? AND status = 'active' AND id != ?`,
            [config.semester, config.academic_year, id]
        );

        if (activeConfigs.length > 0) {
            return res.status(400).json({
                success: false,
                message: '该学期已有激活的选课配置，请先关闭其他配置'
            });
        }

        // 检查时间是否合理
        const now = moment();
        const startTime = moment(config.start_time);
        const endTime = moment(config.end_time);

        if (endTime.isBefore(now)) {
            return res.status(400).json({
                success: false,
                message: '选课结束时间已过，无法激活'
            });
        }

        // 激活配置
        await query(
            'UPDATE course_selection_config SET status = "active", updated_at = NOW() WHERE id = ?',
            [id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'activate',
                'selection_config',
                `激活选课配置: ${config.academic_year}学年${config.semester}学期第${config.round_number}轮`,
                'selection_config',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '选课配置激活成功'
        });

    } catch (error) {
        console.error('激活选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 结束选课配置
exports.endSelectionConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查配置是否存在
        const configs = await query(
            'SELECT * FROM course_selection_config WHERE id = ?',
            [id]
        );

        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '选课配置不存在'
            });
        }

        const config = configs[0];

        if (config.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: '只能结束激活状态的选课配置'
            });
        }

        // 结束配置
        await query(
            'UPDATE course_selection_config SET status = "ended", updated_at = NOW() WHERE id = ?',
            [id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'end',
                'selection_config',
                `结束选课配置: ${config.academic_year}学年${config.semester}学期第${config.round_number}轮`,
                'selection_config',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '选课配置已结束'
        });

    } catch (error) {
        console.error('结束选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 删除选课配置
exports.deleteSelectionConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查配置是否存在
        const configs = await query(
            'SELECT * FROM course_selection_config WHERE id = ?',
            [id]
        );

        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '选课配置不存在'
            });
        }

        const config = configs[0];

        // 只能删除草稿状态的配置
        if (config.status !== 'draft') {
            return res.status(400).json({
                success: false,
                message: '只能删除草稿状态的选课配置'
            });
        }

        // 删除配置
        await query('DELETE FROM course_selection_config WHERE id = ?', [id]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'delete',
                'selection_config',
                `删除选课配置: ${config.academic_year}学年${config.semester}学期第${config.round_number}轮`,
                'selection_config',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '选课配置删除成功'
        });

    } catch (error) {
        console.error('删除选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取当前激活的选课配置
exports.getCurrentConfig = async (req, res) => {
    try {
        const configs = await query(
            `SELECT * FROM course_selection_config 
             WHERE status = 'active' AND start_time <= NOW() AND end_time >= NOW()
             ORDER BY created_at DESC LIMIT 1`
        );

        if (configs.length === 0) {
            return res.json({
                success: true,
                data: null,
                message: '当前没有激活的选课配置'
            });
        }

        res.json({
            success: true,
            data: configs[0]
        });

    } catch (error) {
        console.error('获取当前选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 复制选课配置
exports.copySelectionConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const { semester, academic_year, round_number } = req.body;
        const adminId = req.user.id;

        // 获取原配置
        const configs = await query(
            'SELECT * FROM course_selection_config WHERE id = ?',
            [id]
        );

        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: '原选课配置不存在'
            });
        }

        const originalConfig = configs[0];

        // 检查新配置是否已存在
        const existingConfigs = await query(
            'SELECT id FROM course_selection_config WHERE semester = ? AND academic_year = ? AND round_number = ?',
            [semester, academic_year, round_number]
        );

        if (existingConfigs.length > 0) {
            return res.status(400).json({
                success: false,
                message: '目标学期轮次的选课配置已存在'
            });
        }

        // 复制配置
        const result = await query(
            `INSERT INTO course_selection_config 
             (semester, academic_year, round_number, round_name, selection_method, start_time, end_time, 
              max_credits, max_courses, allow_drop, allow_change, priority_rules, lottery_config, description, created_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
            [
                semester, academic_year, round_number,
                originalConfig.round_name,
                originalConfig.selection_method,
                originalConfig.start_time,
                originalConfig.end_time,
                originalConfig.max_credits,
                originalConfig.max_courses,
                originalConfig.allow_drop,
                originalConfig.allow_change,
                originalConfig.priority_rules,
                originalConfig.lottery_config,
                originalConfig.description,
                adminId
            ]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'copy',
                'selection_config',
                `复制选课配置到: ${academic_year}学年${semester}学期第${round_number}轮`,
                'selection_config',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '选课配置复制成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('复制选课配置错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};
