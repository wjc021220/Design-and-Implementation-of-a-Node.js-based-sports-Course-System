const { query } = require('../config/database');
const moment = require('moment');
const DataIntegrityValidator = require('../utils/dataIntegrityValidator');

// ==================== 系统监控 ====================

// 获取系统概览数据
exports.getSystemOverview = async (req, res) => {
    try {
        // 获取基础统计数据
        const userStats = await query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
                COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_users_week
            FROM users
        `);

        const teacherStats = await query(`
            SELECT 
                COUNT(*) as total_teachers,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_teachers
            FROM teachers
        `);

        const courseStats = await query(`
            SELECT 
                COUNT(*) as total_courses,
                COUNT(CASE WHEN status = 'published' THEN 1 END) as published_courses,
                COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_courses
            FROM courses
        `);

        const selectionStats = await query(`
            SELECT 
                COUNT(*) as total_selections,
                COUNT(CASE WHEN status = 'selected' THEN 1 END) as successful_selections,
                COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting_selections,
                COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as selections_today
            FROM course_selections
        `);

        const venueStats = await query(`
            SELECT 
                COUNT(*) as total_venues,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_venues
            FROM venues
        `);

        // 获取当前选课配置
        const currentConfigResult = await query(`
            SELECT * FROM course_selection_config 
            WHERE status = 'active' AND start_time <= NOW() AND end_time >= NOW()
            ORDER BY created_at DESC LIMIT 1
        `);

        res.json({
            success: true,
            data: {
                users: userStats[0],
                teachers: teacherStats[0],
                courses: courseStats[0],
                selections: selectionStats[0],
                venues: venueStats[0],
                currentConfig: (currentConfigResult && currentConfigResult[0]) || null
            }
        });

    } catch (error) {
        console.error('获取系统概览错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取选课进度统计
exports.getSelectionProgress = async (req, res) => {
    try {
        const { semester, academic_year } = req.query;

        let whereClause = '';
        let params = [];

        if (semester && academic_year) {
            whereClause = 'WHERE c.semester = ? AND c.academic_year = ?';
            params = [semester, academic_year];
        }

        // 获取课程选课统计
        const courseProgress = await query(`
            SELECT 
                c.id,
                c.name,
                c.capacity,
                c.category,
                t.name as teacher_name,
                v.name as venue_name,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as selected_count,
                COUNT(CASE WHEN cs.status = 'waiting' THEN 1 END) as waiting_count,
                ROUND(COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) / c.capacity * 100, 2) as fill_rate
            FROM courses c
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            LEFT JOIN course_selections cs ON c.id = cs.course_id
            ${whereClause}
            GROUP BY c.id
            ORDER BY fill_rate DESC, selected_count DESC
        `, params);

        // 获取选课时间分布
        const timeDistribution = await query(`
            SELECT 
                DATE(cs.created_at) as selection_date,
                HOUR(cs.created_at) as selection_hour,
                COUNT(*) as selection_count,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as success_count
            FROM course_selections cs
            LEFT JOIN courses c ON cs.course_id = c.id
            ${whereClause.replace('WHERE', 'WHERE')}
            AND cs.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(cs.created_at), HOUR(cs.created_at)
            ORDER BY selection_date DESC, selection_hour
        `, params);

        // 获取选课成功率统计
        const successRate = await query(`
            SELECT 
                DATE(cs.created_at) as date,
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as successful_attempts,
                ROUND(COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) / COUNT(*) * 100, 2) as success_rate
            FROM course_selections cs
            LEFT JOIN courses c ON cs.course_id = c.id
            ${whereClause.replace('WHERE', 'WHERE')}
            AND cs.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(cs.created_at)
            ORDER BY date DESC
        `, params);

        res.json({
            success: true,
            data: {
                courseProgress,
                timeDistribution,
                successRate
            }
        });

    } catch (error) {
        console.error('获取选课进度错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取课程受欢迎度统计
exports.getCoursePopularity = async (req, res) => {
    try {
        const { page = 1, limit = 20, semester, academic_year, category } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (semester) {
            whereConditions.push('cp.semester = ?');
            params.push(semester);
        }

        if (academic_year) {
            whereConditions.push('cp.academic_year = ?');
            params.push(academic_year);
        }

        if (category) {
            whereConditions.push('c.category = ?');
            params.push(category);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(`
            SELECT COUNT(*) as total 
            FROM course_popularity cp
            LEFT JOIN courses c ON cp.course_id = c.id
            ${whereClause}
        `, params);

        // 获取课程受欢迎度数据
        const popularity = await query(`
            SELECT 
                cp.*,
                c.name as course_name,
                c.category,
                c.capacity,
                t.name as teacher_name,
                v.name as venue_name,
                ROUND(cp.successful_selections / cp.selection_attempts * 100, 2) as success_rate,
                ROUND(cp.view_count / cp.selection_attempts, 2) as view_to_selection_ratio
            FROM course_popularity cp
            LEFT JOIN courses c ON cp.course_id = c.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            ${whereClause}
            ORDER BY cp.popularity_score DESC, cp.successful_selections DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, params);

        // 获取类别统计
        const categoryStats = await query(`
            SELECT 
                c.category,
                COUNT(*) as course_count,
                AVG(cp.popularity_score) as avg_popularity,
                SUM(cp.successful_selections) as total_selections,
                SUM(cp.view_count) as total_views
            FROM course_popularity cp
            LEFT JOIN courses c ON cp.course_id = c.id
            ${whereClause}
            GROUP BY c.category
            ORDER BY avg_popularity DESC
        `, params);

        res.json({
            success: true,
            data: {
                list: popularity,
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit),
                categoryStats
            }
        });

    } catch (error) {
        console.error('获取课程受欢迎度错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取系统性能统计
exports.getSystemPerformance = async (req, res) => {
    try {
        const { period = '24h' } = req.query;

        let timeCondition = '';
        let groupBy = '';

        switch (period) {
            case '1h':
                timeCondition = 'WHERE ss.created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)';
                groupBy = 'DATE_FORMAT(ss.created_at, "%Y-%m-%d %H:%i")';
                break;
            case '24h':
                timeCondition = 'WHERE ss.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
                groupBy = 'DATE_FORMAT(ss.created_at, "%Y-%m-%d %H:00")';
                break;
            case '7d':
                timeCondition = 'WHERE ss.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
                groupBy = 'DATE(ss.created_at)';
                break;
            case '30d':
                timeCondition = 'WHERE ss.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
                groupBy = 'DATE(ss.created_at)';
                break;
        }

        // 获取系统性能数据
        const performance = await query(`
            SELECT 
                ${groupBy} as time_period,
                AVG(ss.concurrent_users) as avg_concurrent_users,
                MAX(ss.concurrent_users) as max_concurrent_users,
                AVG(ss.response_time) as avg_response_time,
                MAX(ss.response_time) as max_response_time,
                AVG(ss.system_load) as avg_system_load,
                MAX(ss.system_load) as max_system_load,
                SUM(ss.total_selections) as total_selections,
                SUM(ss.successful_selections) as successful_selections,
                SUM(ss.failed_selections) as failed_selections
            FROM selection_statistics ss
            ${timeCondition}
            GROUP BY ${groupBy}
            ORDER BY time_period DESC
        `);

        // 获取当前系统状态
        const currentStatus = await query(`
            SELECT 
                concurrent_users,
                response_time,
                system_load,
                created_at
            FROM selection_statistics 
            ORDER BY created_at DESC 
            LIMIT 1
        `);

        res.json({
            success: true,
            data: {
                performance,
                currentStatus: currentStatus[0] || null
            }
        });

    } catch (error) {
        console.error('获取系统性能错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取用户行为统计
exports.getUserBehaviorStats = async (req, res) => {
    try {
        const { period = '7d' } = req.query;

        let timeCondition = '';
        switch (period) {
            case '24h':
                timeCondition = 'AND cs.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
                break;
            case '7d':
                timeCondition = 'AND cs.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
                break;
            case '30d':
                timeCondition = 'AND cs.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
                break;
        }

        // 获取用户选课行为统计
        const userBehavior = await query(`
            SELECT 
                u.grade,
                u.major,
                COUNT(DISTINCT u.id) as user_count,
                COUNT(cs.id) as total_selections,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as successful_selections,
                AVG(CASE WHEN cs.status = 'selected' THEN 1 ELSE 0 END) as success_rate,
                COUNT(CASE WHEN cs.status = 'waiting' THEN 1 END) as waiting_selections
            FROM users u
            LEFT JOIN course_selections cs ON u.id = cs.user_id
            WHERE u.status = 'active' ${timeCondition}
            GROUP BY u.grade, u.major
            ORDER BY successful_selections DESC
        `);

        // 获取选课时间偏好
        const timePreference = await query(`
            SELECT 
                HOUR(cs.created_at) as hour,
                COUNT(*) as selection_count,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as success_count
            FROM course_selections cs
            WHERE cs.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY HOUR(cs.created_at)
            ORDER BY hour
        `);

        // 获取课程类别偏好
        const categoryPreference = await query(`
            SELECT 
                c.category,
                COUNT(*) as selection_count,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as success_count,
                COUNT(DISTINCT cs.user_id) as unique_users
            FROM course_selections cs
            LEFT JOIN courses c ON cs.course_id = c.id
            WHERE cs.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY c.category
            ORDER BY selection_count DESC
        `);

        res.json({
            success: true,
            data: {
                userBehavior,
                timePreference,
                categoryPreference
            }
        });

    } catch (error) {
        console.error('获取用户行为统计错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// ==================== 实时监控 ====================

// 获取实时选课状态
exports.getRealTimeStatus = async (req, res) => {
    try {
        // 获取当前激活的选课配置
        const currentConfigResult = await query(`
            SELECT * FROM course_selection_config 
            WHERE status = 'active' AND start_time <= NOW() AND end_time >= NOW()
            ORDER BY created_at DESC LIMIT 1
        `);

        if (!currentConfigResult || currentConfigResult.length === 0) {
            return res.json({
                success: true,
                data: {
                    isActive: false,
                    message: '当前没有激活的选课配置'
                }
            });
        }

        const config = currentConfigResult[0];

        // 获取最近5分钟的选课活动
        const recentActivity = await query(`
            SELECT 
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN status = 'selected' THEN 1 END) as successful_attempts,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_attempts,
                COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting_attempts
            FROM course_selections 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        `);

        // 获取当前最热门的课程
        const hotCourses = await query(`
            SELECT 
                c.id,
                c.name,
                c.capacity,
                COUNT(CASE WHEN cs.status = 'selected' THEN 1 END) as selected_count,
                COUNT(CASE WHEN cs.status = 'waiting' THEN 1 END) as waiting_count,
                COUNT(CASE WHEN cs.created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 1 END) as recent_attempts
            FROM courses c
            LEFT JOIN course_selections cs ON c.id = cs.course_id
            WHERE c.status = 'published'
            GROUP BY c.id
            HAVING recent_attempts > 0
            ORDER BY recent_attempts DESC, waiting_count DESC
            LIMIT 10
        `);

        // 获取系统负载指标
        const systemLoad = await query(`
            SELECT 
                concurrent_users,
                response_time,
                system_load,
                created_at
            FROM selection_statistics 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
            ORDER BY created_at DESC 
            LIMIT 12
        `);

        res.json({
            success: true,
            data: {
                isActive: true,
                config,
                recentActivity: recentActivity[0],
                hotCourses,
                systemLoad
            }
        });

    } catch (error) {
        console.error('获取实时状态错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新系统统计数据
exports.updateSystemStats = async (req, res) => {
    try {
        const { concurrent_users, response_time, system_load } = req.body;
        const adminId = req.user.id;

        const now = new Date();
        const date = moment(now).format('YYYY-MM-DD');
        const hour = now.getHours();

        // 获取当前小时的选课统计
        const selectionStats = await query(`
            SELECT 
                COUNT(*) as total_selections,
                COUNT(CASE WHEN status = 'selected' THEN 1 END) as successful_selections,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_selections
            FROM course_selections 
            WHERE DATE(created_at) = ? AND HOUR(created_at) = ?
        `, [date, hour]);

        const stats = selectionStats[0];

        // 插入或更新统计数据
        await query(`
            INSERT INTO selection_statistics 
            (date, hour, total_selections, successful_selections, failed_selections, concurrent_users, response_time, system_load)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            total_selections = ?,
            successful_selections = ?,
            failed_selections = ?,
            concurrent_users = ?,
            response_time = ?,
            system_load = ?
        `, [
            date, hour, stats.total_selections, stats.successful_selections, stats.failed_selections,
            concurrent_users, response_time, system_load,
            stats.total_selections, stats.successful_selections, stats.failed_selections,
            concurrent_users, response_time, system_load
        ]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'system_monitoring',
                `更新系统统计数据: ${date} ${hour}:00`,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '系统统计数据更新成功'
        });

    } catch (error) {
        console.error('更新系统统计错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取异常事件列表
exports.getSystemIncidents = async (req, res) => {
    try {
        const { page = 1, limit = 10, incident_type, severity, status } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (incident_type) {
            whereConditions.push('incident_type = ?');
            params.push(incident_type);
        }

        if (severity) {
            whereConditions.push('severity = ?');
            params.push(severity);
        }

        if (status) {
            whereConditions.push('resolution_status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total FROM system_incidents ${whereClause}`,
            params
        );

        // 获取异常事件列表
        const incidents = await query(`
            SELECT 
                si.*,
                au1.real_name as assigned_to_name
            FROM system_incidents si
            LEFT JOIN admin_users au1 ON si.assigned_to = au1.id
            ${whereClause}
            ORDER BY si.created_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, params);

        res.json({
            success: true,
            data: {
                list: incidents,
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('获取异常事件列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 创建异常事件
exports.createSystemIncident = async (req, res) => {
    try {
        const { incident_type, severity, title, description, affected_users, error_details } = req.body;
        const adminId = req.user.id;

        if (!incident_type || !severity || !title || !description) {
            return res.status(400).json({
                success: false,
                message: '事件类型、严重程度、标题和描述不能为空'
            });
        }

        // 创建异常事件
        const result = await query(`
            INSERT INTO system_incidents 
            (incident_type, severity, title, description, affected_users, error_details, assigned_to)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [incident_type, severity, title, description, affected_users, JSON.stringify(error_details || {}), adminId]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'incident_management',
                `创建异常事件: ${title}`,
                'system_incident',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '异常事件创建成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('创建异常事件错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新异常事件状态
exports.updateIncidentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution_status, resolution_notes } = req.body;
        const adminId = req.user.id;

        // 检查事件是否存在
        const incidents = await query(
            'SELECT * FROM system_incidents WHERE id = ?',
            [id]
        );

        if (incidents.length === 0) {
            return res.status(404).json({
                success: false,
                message: '异常事件不存在'
            });
        }

        const updateData = {
            resolution_status,
            resolution_notes
        };

        if (resolution_status === 'resolved' || resolution_status === 'closed') {
            updateData.resolved_at = new Date();
        }

        // 更新事件状态（注意：数据库表中暂无resolved_by列）
        await query(`
            UPDATE system_incidents 
            SET resolution_status = ?, resolution_notes = ?, resolved_at = ?, updated_at = NOW()
            WHERE id = ?
        `, [resolution_status, resolution_notes, updateData.resolved_at, id]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'incident_management',
                `更新异常事件状态: ${incidents[0].title} -> ${resolution_status}`,
                'system_incident',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '异常事件状态更新成功'
        });

    } catch (error) {
        console.error('更新异常事件状态错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// ==================== 数据完整性验证 ====================

// 执行数据完整性验证
exports.validateDataIntegrity = async (req, res) => {
    try {
        console.log('开始执行数据完整性验证...');
        
        const validator = new DataIntegrityValidator();
        const result = await validator.validate();

        // 记录操作日志
        const { logAdminOperation } = require('./adminAuthController');
        await logAdminOperation(
            req.user.id,
            'validate',
            'system_monitoring',
            '执行数据完整性验证',
            { 
                result: result.success ? 'passed' : 'failed',
                errors_count: result.errors.length,
                warnings_count: result.warnings.length
            },
            result.success ? 'success' : 'failed',
            req,
            result.errors.length > 0 ? result.errors.join('; ') : null
        );

        res.json({
            success: true,
            data: {
                validation_passed: result.success,
                summary: {
                    total_errors: result.errors.length,
                    total_warnings: result.warnings.length,
                    total_info: result.info.length
                },
                errors: result.errors,
                warnings: result.warnings,
                info: result.info,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('数据完整性验证失败:', error);

        // 记录错误日志
        const { logAdminOperation } = require('./adminAuthController');
        await logAdminOperation(
            req.user.id,
            'validate',
            'system_monitoring',
            '数据完整性验证失败',
            { error: error.message },
            'failed',
            req,
            error.message
        );

        res.status(500).json({
            success: false,
            message: '数据完整性验证失败',
            error: error.message
        });
    }
};

// 获取数据关联状态报告
exports.getDataRelationStatus = async (req, res) => {
    try {
        // 快速检查关键数据关联状态
        const checks = [];

        // 检查学生-选课关联
        const studentSelectionCheck = await query(`
            SELECT COUNT(*) as invalid_count
            FROM course_selections cs
            LEFT JOIN users u ON cs.user_id = u.id
            LEFT JOIN courses c ON cs.course_id = c.id
            WHERE u.id IS NULL OR c.id IS NULL
        `);
        
        checks.push({
            name: '学生选课关联',
            status: studentSelectionCheck[0].invalid_count === 0 ? 'healthy' : 'error',
            details: `${studentSelectionCheck[0].invalid_count}条无效记录`,
            severity: studentSelectionCheck[0].invalid_count > 0 ? 'high' : 'none'
        });

        // 检查课程-教师关联
        const courseTeacherCheck = await query(`
            SELECT COUNT(*) as invalid_count
            FROM courses c
            LEFT JOIN teachers t ON c.teacher_id = t.id
            WHERE c.status = 'published' AND t.id IS NULL
        `);

        checks.push({
            name: '课程教师关联',
            status: courseTeacherCheck[0].invalid_count === 0 ? 'healthy' : 'warning',
            details: `${courseTeacherCheck[0].invalid_count}门课程缺少教师`,
            severity: courseTeacherCheck[0].invalid_count > 0 ? 'medium' : 'none'
        });

        // 检查课程-场地关联
        const courseVenueCheck = await query(`
            SELECT COUNT(*) as invalid_count
            FROM courses c
            LEFT JOIN venues v ON c.venue_id = v.id
            WHERE c.status = 'published' AND v.id IS NULL
        `);

        checks.push({
            name: '课程场地关联',
            status: courseVenueCheck[0].invalid_count === 0 ? 'healthy' : 'warning',
            details: `${courseVenueCheck[0].invalid_count}门课程缺少场地`,
            severity: courseVenueCheck[0].invalid_count > 0 ? 'medium' : 'none'
        });

        // 检查教师用户关联
        const teacherUserCheck = await query(`
            SELECT COUNT(*) as invalid_count
            FROM users u
            LEFT JOIN teachers t ON u.teacher_id = t.id
            WHERE u.user_type = 'teacher' AND t.id IS NULL
        `);

        checks.push({
            name: '教师用户关联',
            status: teacherUserCheck[0].invalid_count === 0 ? 'healthy' : 'warning',
            details: `${teacherUserCheck[0].invalid_count}个教师用户缺少教师信息`,
            severity: teacherUserCheck[0].invalid_count > 0 ? 'medium' : 'none'
        });

        // 检查选课配置
        const configCheck = await query(`
            SELECT COUNT(*) as active_count
            FROM course_selection_config
            WHERE status = 'active'
        `);

        checks.push({
            name: '选课配置',
            status: configCheck[0].active_count === 1 ? 'healthy' : 
                   configCheck[0].active_count === 0 ? 'warning' : 'error',
            details: `${configCheck[0].active_count}个活跃配置`,
            severity: configCheck[0].active_count === 1 ? 'none' : 
                     configCheck[0].active_count === 0 ? 'medium' : 'high'
        });

        // 计算总体健康状态
        const errorCount = checks.filter(c => c.status === 'error').length;
        const warningCount = checks.filter(c => c.status === 'warning').length;
        
        let overallStatus = 'healthy';
        if (errorCount > 0) {
            overallStatus = 'error';
        } else if (warningCount > 0) {
            overallStatus = 'warning';
        }

        res.json({
            success: true,
            data: {
                overall_status: overallStatus,
                summary: {
                    total_checks: checks.length,
                    healthy: checks.filter(c => c.status === 'healthy').length,
                    warnings: warningCount,
                    errors: errorCount
                },
                checks: checks,
                last_updated: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('获取数据关联状态失败:', error);
        res.status(500).json({
            success: false,
            message: '获取数据关联状态失败',
            error: error.message
        });
    }
};
