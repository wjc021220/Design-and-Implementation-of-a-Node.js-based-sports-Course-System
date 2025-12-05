const { query } = require('../config/database');
const moment = require('moment');

// ==================== 紧急处理功能 ====================

// 手动调整选课结果
exports.adjustCourseSelection = async (req, res) => {
    try {
        const { user_id, course_id, action, reason } = req.body;
        const adminId = req.user.id;

        if (!user_id || !course_id || !action || !reason) {
            return res.status(400).json({
                success: false,
                message: '用户ID、课程ID、操作类型和原因不能为空'
            });
        }

        // 验证操作类型
        const validActions = ['force_select', 'force_drop', 'move_to_waiting', 'remove_from_waiting'];
        if (!validActions.includes(action)) {
            return res.status(400).json({
                success: false,
                message: '无效的操作类型'
            });
        }

        // 获取用户和课程信息
        const users = await query('SELECT * FROM users WHERE id = ?', [user_id]);
        const courses = await query('SELECT * FROM courses WHERE id = ?', [course_id]);

        if (users.length === 0 || courses.length === 0) {
            return res.status(404).json({
                success: false,
                message: '用户或课程不存在'
            });
        }

        const user = users[0];
        const course = courses[0];

        // 开始事务
        await query('START TRANSACTION');

        try {
            let operationResult = '';

            switch (action) {
                case 'force_select':
                    operationResult = await forceSelectCourse(user_id, course_id, adminId, reason);
                    break;
                case 'force_drop':
                    operationResult = await forceDropCourse(user_id, course_id, adminId, reason);
                    break;
                case 'move_to_waiting':
                    operationResult = await moveToWaitingList(user_id, course_id, adminId, reason);
                    break;
                case 'remove_from_waiting':
                    operationResult = await removeFromWaitingList(user_id, course_id, adminId, reason);
                    break;
            }

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'manual_adjust',
                    'emergency_handling',
                    `手动调整选课: ${user.student_id} - ${course.name} (${action}) - 原因: ${reason}`,
                    'course_selection',
                    `${user_id}_${course_id}`,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            // 提交事务
            await query('COMMIT');

            res.json({
                success: true,
                message: '选课调整成功',
                data: { result: operationResult }
            });

        } catch (error) {
            // 回滚事务
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('手动调整选课错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '服务器内部错误'
        });
    }
};

// 强制选课
async function forceSelectCourse(user_id, course_id, admin_id, reason) {
    // 检查是否已经选课
    const existingSelection = await query(
        'SELECT * FROM course_selections WHERE user_id = ? AND course_id = ?',
        [user_id, course_id]
    );

    if (existingSelection.length > 0) {
        const selection = existingSelection[0];
        if (selection.status === 'selected') {
            throw new Error('用户已经选择了该课程');
        }
        
        // 更新现有记录
        await query(
            `UPDATE course_selections 
             SET status = 'selected', selected_at = NOW(), admin_notes = ?
             WHERE user_id = ? AND course_id = ?`,
            [`管理员强制选课: ${reason}`, user_id, course_id]
        );
    } else {
        // 创建新的选课记录
        await query(
            `INSERT INTO course_selections (user_id, course_id, status, selected_at, admin_notes)
             VALUES (?, ?, 'selected', NOW(), ?)`,
            [user_id, course_id, `管理员强制选课: ${reason}`]
        );
    }

    return '强制选课成功';
}

// 强制退课
async function forceDropCourse(user_id, course_id, admin_id, reason) {
    // 检查选课记录
    const selections = await query(
        'SELECT * FROM course_selections WHERE user_id = ? AND course_id = ? AND status = "selected"',
        [user_id, course_id]
    );

    if (selections.length === 0) {
        throw new Error('用户未选择该课程');
    }

    // 删除选课记录
    await query(
        'DELETE FROM course_selections WHERE user_id = ? AND course_id = ? AND status = "selected"',
        [user_id, course_id]
    );

    // 检查是否有候补学生可以递补
    const waitingStudents = await query(
        `SELECT * FROM course_selections 
         WHERE course_id = ? AND status = 'waiting' 
         ORDER BY created_at ASC LIMIT 1`,
        [course_id]
    );

    if (waitingStudents.length > 0) {
        const waitingStudent = waitingStudents[0];
        await query(
            `UPDATE course_selections 
             SET status = 'selected', selected_at = NOW(), admin_notes = ?
             WHERE id = ?`,
            [`候补转正 - 原因: ${reason}`, waitingStudent.id]
        );
    }

    return '强制退课成功，候补学生已自动递补';
}

// 移至候补队列
async function moveToWaitingList(user_id, course_id, admin_id, reason) {
    // 检查选课记录
    const selections = await query(
        'SELECT * FROM course_selections WHERE user_id = ? AND course_id = ? AND status = "selected"',
        [user_id, course_id]
    );

    if (selections.length === 0) {
        throw new Error('用户未选择该课程');
    }

    // 更新为候补状态
    await query(
        `UPDATE course_selections 
         SET status = 'waiting', selected_at = NULL, admin_notes = ?
         WHERE user_id = ? AND course_id = ?`,
        [`管理员移至候补: ${reason}`, user_id, course_id]
    );

    return '已移至候补队列';
}

// 从候补队列移除
async function removeFromWaitingList(user_id, course_id, admin_id, reason) {
    // 检查候补记录
    const selections = await query(
        'SELECT * FROM course_selections WHERE user_id = ? AND course_id = ? AND status = "waiting"',
        [user_id, course_id]
    );

    if (selections.length === 0) {
        throw new Error('用户不在该课程的候补队列中');
    }

    // 删除候补记录
    await query(
        'DELETE FROM course_selections WHERE user_id = ? AND course_id = ? AND status = "waiting"',
        [user_id, course_id]
    );

    return '已从候补队列移除';
}

// 批量处理选课异常
exports.batchProcessSelections = async (req, res) => {
    try {
        const { operations, reason } = req.body;
        const adminId = req.user.id;

        if (!Array.isArray(operations) || operations.length === 0) {
            return res.status(400).json({
                success: false,
                message: '操作列表不能为空'
            });
        }

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: '批量操作原因不能为空'
            });
        }

        const results = [];
        let successCount = 0;
        let failureCount = 0;

        // 开始事务
        await query('START TRANSACTION');

        try {
            for (const operation of operations) {
                const { user_id, course_id, action } = operation;
                
                try {
                    let operationResult = '';
                    
                    switch (action) {
                        case 'force_select':
                            operationResult = await forceSelectCourse(user_id, course_id, adminId, reason);
                            break;
                        case 'force_drop':
                            operationResult = await forceDropCourse(user_id, course_id, adminId, reason);
                            break;
                        case 'move_to_waiting':
                            operationResult = await moveToWaitingList(user_id, course_id, adminId, reason);
                            break;
                        case 'remove_from_waiting':
                            operationResult = await removeFromWaitingList(user_id, course_id, adminId, reason);
                            break;
                        default:
                            throw new Error('无效的操作类型');
                    }

                    results.push({
                        user_id,
                        course_id,
                        action,
                        success: true,
                        message: operationResult
                    });
                    successCount++;

                } catch (error) {
                    results.push({
                        user_id,
                        course_id,
                        action,
                        success: false,
                        message: error.message
                    });
                    failureCount++;
                }
            }

            // 记录批量操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'batch_adjust',
                    'emergency_handling',
                    `批量处理选课异常: 成功${successCount}个，失败${failureCount}个 - 原因: ${reason}`,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            // 提交事务
            await query('COMMIT');

            res.json({
                success: true,
                message: '批量处理完成',
                data: {
                    total: operations.length,
                    successCount,
                    failureCount,
                    results
                }
            });

        } catch (error) {
            // 回滚事务
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('批量处理选课错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 系统维护模式控制
exports.toggleMaintenanceMode = async (req, res) => {
    try {
        const { enabled, message, estimated_duration } = req.body;
        const adminId = req.user.id;

        // 更新系统配置
        await query(
            `INSERT INTO system_config (config_key, config_value, config_type, category, description, is_public, updated_by)
             VALUES ('system_maintenance_mode', ?, 'boolean', 'system', '系统维护模式', TRUE, ?)
             ON DUPLICATE KEY UPDATE 
             config_value = ?, updated_by = ?, updated_at = NOW()`,
            [enabled.toString(), adminId, enabled.toString(), adminId]
        );

        if (message) {
            await query(
                `INSERT INTO system_config (config_key, config_value, config_type, category, description, is_public, updated_by)
                 VALUES ('maintenance_message', ?, 'string', 'system', '维护模式消息', TRUE, ?)
                 ON DUPLICATE KEY UPDATE 
                 config_value = ?, updated_by = ?, updated_at = NOW()`,
                [message, adminId, message, adminId]
            );
        }

        if (estimated_duration) {
            await query(
                `INSERT INTO system_config (config_key, config_value, config_type, category, description, is_public, updated_by)
                 VALUES ('maintenance_duration', ?, 'string', 'system', '预计维护时长', TRUE, ?)
                 ON DUPLICATE KEY UPDATE 
                 config_value = ?, updated_by = ?, updated_at = NOW()`,
                [estimated_duration, adminId, estimated_duration, adminId]
            );
        }

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                enabled ? 'enable' : 'disable',
                'system_maintenance',
                `${enabled ? '启用' : '关闭'}系统维护模式${message ? ` - ${message}` : ''}`,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: `系统维护模式已${enabled ? '启用' : '关闭'}`
        });

    } catch (error) {
        console.error('切换维护模式错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 紧急停止选课
exports.emergencyStopSelection = async (req, res) => {
    try {
        const { reason, notify_users = true } = req.body;
        const adminId = req.user.id;

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: '停止原因不能为空'
            });
        }

        // 获取当前激活的选课配置
        const activeConfigs = await query(
            'SELECT * FROM course_selection_config WHERE status = "active"'
        );

        if (activeConfigs.length === 0) {
            return res.status(400).json({
                success: false,
                message: '当前没有激活的选课配置'
            });
        }

        // 开始事务
        await query('START TRANSACTION');

        try {
            // 停止所有激活的选课配置
            await query(
                'UPDATE course_selection_config SET status = "cancelled", updated_at = NOW() WHERE status = "active"'
            );

            // 创建系统异常事件
            await query(
                `INSERT INTO system_incidents 
                 (incident_type, severity, title, description, assigned_to, resolution_status)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    'system_error',
                    'high',
                    '紧急停止选课',
                    `管理员紧急停止选课 - 原因: ${reason}`,
                    adminId,
                    'resolved'
                ]
            );

            // 如果需要通知用户，创建系统通知
            if (notify_users) {
                await query(
                    `INSERT INTO system_notifications 
                     (notification_type, target_type, title, content, priority, is_published, publish_time, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
                    [
                        'emergency',
                        'all',
                        '选课系统紧急停止',
                        `由于${reason}，选课系统已紧急停止。请等待进一步通知。`,
                        'urgent',
                        true,
                        adminId
                    ]
                );
            }

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'emergency_stop',
                    'emergency_handling',
                    `紧急停止选课 - 原因: ${reason}`,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            // 提交事务
            await query('COMMIT');

            res.json({
                success: true,
                message: '选课已紧急停止',
                data: {
                    stopped_configs: activeConfigs.length,
                    notification_sent: notify_users
                }
            });

        } catch (error) {
            // 回滚事务
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('紧急停止选课错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 清理异常数据
exports.cleanupAnomalousData = async (req, res) => {
    try {
        const { cleanup_type, confirm = false } = req.body;
        const adminId = req.user.id;

        if (!confirm) {
            return res.status(400).json({
                success: false,
                message: '请确认执行清理操作'
            });
        }

        const validCleanupTypes = ['duplicate_selections', 'orphaned_records', 'expired_waiting', 'invalid_status'];
        if (!validCleanupTypes.includes(cleanup_type)) {
            return res.status(400).json({
                success: false,
                message: '无效的清理类型'
            });
        }

        let cleanupResult = '';
        let affectedRows = 0;

        // 开始事务
        await query('START TRANSACTION');

        try {
            switch (cleanup_type) {
                case 'duplicate_selections':
                    // 清理重复的选课记录
                    const duplicates = await query(`
                        DELETE cs1 FROM course_selections cs1
                        INNER JOIN course_selections cs2 
                        WHERE cs1.id > cs2.id 
                        AND cs1.user_id = cs2.user_id 
                        AND cs1.course_id = cs2.course_id
                    `);
                    affectedRows = duplicates.affectedRows;
                    cleanupResult = `清理重复选课记录 ${affectedRows} 条`;
                    break;

                case 'orphaned_records':
                    // 清理孤立的选课记录（用户或课程已删除）
                    const orphaned = await query(`
                        DELETE cs FROM course_selections cs
                        LEFT JOIN users u ON cs.user_id = u.id
                        LEFT JOIN courses c ON cs.course_id = c.id
                        WHERE u.id IS NULL OR c.id IS NULL
                    `);
                    affectedRows = orphaned.affectedRows;
                    cleanupResult = `清理孤立选课记录 ${affectedRows} 条`;
                    break;

                case 'expired_waiting':
                    // 清理过期的候补记录（超过30天）
                    const expired = await query(`
                        DELETE FROM course_selections 
                        WHERE status = 'waiting' 
                        AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
                    `);
                    affectedRows = expired.affectedRows;
                    cleanupResult = `清理过期候补记录 ${affectedRows} 条`;
                    break;

                case 'invalid_status':
                    // 修复无效状态的选课记录
                    const invalid = await query(`
                        UPDATE course_selections 
                        SET status = 'failed' 
                        WHERE status NOT IN ('selected', 'waiting', 'failed', 'dropped')
                    `);
                    affectedRows = invalid.affectedRows;
                    cleanupResult = `修复无效状态记录 ${affectedRows} 条`;
                    break;
            }

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'cleanup',
                    'data_maintenance',
                    `数据清理: ${cleanup_type} - ${cleanupResult}`,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            // 提交事务
            await query('COMMIT');

            res.json({
                success: true,
                message: '数据清理完成',
                data: {
                    cleanup_type,
                    affected_rows: affectedRows,
                    result: cleanupResult
                }
            });

        } catch (error) {
            // 回滚事务
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('数据清理错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取系统健康状态
exports.getSystemHealth = async (req, res) => {
    try {
        // 检查数据库连接
        const dbCheckResult = await query('SELECT 1 as status');
        const dbStatus = (dbCheckResult && dbCheckResult.length > 0) ? 'healthy' : 'error';

        // 检查选课配置
        const configCheckResult = await query(
            'SELECT COUNT(*) as count FROM course_selection_config WHERE status = "active"'
        );
        const configStatus = (configCheckResult && configCheckResult[0] && configCheckResult[0].count > 0) ? 'active' : 'inactive';

        // 检查最近的错误
        const recentErrorsResult = await query(`
            SELECT COUNT(*) as error_count 
            FROM admin_operation_logs 
            WHERE result = 'failure' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        `);

        // 检查系统负载
        const systemLoadResult = await query(`
            SELECT 
                AVG(concurrent_users) as avg_users,
                AVG(response_time) as avg_response_time,
                AVG(system_load) as avg_load
            FROM selection_statistics 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        `);

        // 检查待处理的异常事件
        const pendingIncidentsResult = await query(`
            SELECT COUNT(*) as count 
            FROM system_incidents 
            WHERE resolution_status IN ('open', 'investigating')
        `);

        const recentErrorCount = (recentErrorsResult && recentErrorsResult[0]) ? recentErrorsResult[0].error_count : 0;
        const systemLoadData = (systemLoadResult && systemLoadResult[0]) ? systemLoadResult[0] : {};
        const pendingIncidentCount = (pendingIncidentsResult && pendingIncidentsResult[0]) ? pendingIncidentsResult[0].count : 0;

        const healthData = {
            database: {
                status: dbStatus,
                message: dbStatus === 'healthy' ? '数据库连接正常' : '数据库连接异常'
            },
            selection_config: {
                status: configStatus,
                message: configStatus === 'active' ? '选课配置已激活' : '无激活的选课配置'
            },
            error_rate: {
                count: recentErrorCount,
                status: recentErrorCount < 10 ? 'normal' : 'warning',
                message: `最近1小时内错误数: ${recentErrorCount}`
            },
            system_performance: {
                avg_users: Math.round(systemLoadData.avg_users || 0),
                avg_response_time: Math.round(systemLoadData.avg_response_time || 0),
                avg_load: parseFloat((parseFloat(systemLoadData.avg_load) || 0).toFixed(2)),
                status: (systemLoadData.avg_response_time || 0) < 1000 ? 'good' : 'slow'
            },
            pending_incidents: {
                count: pendingIncidentCount,
                status: pendingIncidentCount === 0 ? 'clear' : 'attention',
                message: `待处理异常事件: ${pendingIncidentCount}个`
            }
        };

        // 计算总体健康状态
        const criticalIssues = [
            healthData.database.status === 'error',
            healthData.error_rate.status === 'warning',
            pendingIncidentCount > 5
        ].filter(Boolean).length;

        const overallStatus = criticalIssues === 0 ? 'healthy' : 
                            criticalIssues === 1 ? 'warning' : 'critical';

        res.json({
            success: true,
            data: {
                overall_status: overallStatus,
                timestamp: new Date(),
                details: healthData
            }
        });

    } catch (error) {
        console.error('获取系统健康状态错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误',
            data: {
                overall_status: 'critical',
                timestamp: new Date(),
                error: error.message
            }
        });
    }
};
