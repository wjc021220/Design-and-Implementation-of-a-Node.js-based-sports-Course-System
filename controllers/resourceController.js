const { query } = require('../config/database');

// ==================== 场地管理 ====================

// 获取场地列表
exports.getVenues = async (req, res) => {
    try {
        const { page = 1, limit = 10, keyword, type, status } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (keyword) {
            whereConditions.push('(name LIKE ? OR location LIKE ?)');
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        if (type) {
            whereConditions.push('type = ?');
            params.push(type);
        }

        if (status) {
            whereConditions.push('status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total FROM venues ${whereClause}`,
            params
        );

        // 获取场地列表
        const venues = await query(
            `SELECT v.*, 
                    COUNT(vs.id) as schedule_count,
                    COUNT(CASE WHEN vs.is_available = 1 THEN 1 END) as available_slots
             FROM venues v
             LEFT JOIN venue_schedules vs ON v.id = vs.venue_id
             ${whereClause}
             GROUP BY v.id
             ORDER BY v.created_at DESC
             LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
            params
        );

        res.json({
            success: true,
            data: {
                list: venues,
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('获取场地列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取场地详情
exports.getVenue = async (req, res) => {
    try {
        const { id } = req.params;

        const venues = await query(
            'SELECT * FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 获取场地时间表
        const schedules = await query(
            `SELECT * FROM venue_schedules 
             WHERE venue_id = ? 
             ORDER BY day_of_week, start_time`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...venues[0],
                schedules
            }
        });

    } catch (error) {
        console.error('获取场地详情错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 创建场地
exports.createVenue = async (req, res) => {
    try {
        const { name, type, location, capacity, description, equipment, status } = req.body;
        const adminId = req.user.id;

        if (!name || !type || !location || !capacity) {
            return res.status(400).json({
                success: false,
                message: '场地名称、类型、位置和容量不能为空'
            });
        }

        // 检查场地名称是否已存在
        const existingVenues = await query(
            'SELECT id FROM venues WHERE name = ?',
            [name]
        );

        if (existingVenues.length > 0) {
            return res.status(400).json({
                success: false,
                message: '场地名称已存在'
            });
        }

        // 创建场地
        const result = await query(
            `INSERT INTO venues (name, type, location, capacity, description, equipment, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, type, location, capacity, description, equipment, status || 'active']
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'venue_management',
                `创建场地: ${name}`,
                'venue',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '场地创建成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('创建场地错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新场地
exports.updateVenue = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, type, location, capacity, description, equipment, status } = req.body;
        const adminId = req.user.id;

        // 检查场地是否存在
        const existingVenues = await query(
            'SELECT * FROM venues WHERE id = ?',
            [id]
        );

        if (existingVenues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        const oldVenue = existingVenues[0];

        // 检查名称冲突（排除自己）
        if (name && name !== oldVenue.name) {
            const nameConflict = await query(
                'SELECT id FROM venues WHERE name = ? AND id != ?',
                [name, id]
            );

            if (nameConflict.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '场地名称已存在'
                });
            }
        }

        // 更新场地
        await query(
            `UPDATE venues 
             SET name = ?, type = ?, location = ?, capacity = ?, description = ?, equipment = ?, status = ?, updated_at = NOW()
             WHERE id = ?`,
            [name, type, location, capacity, description, equipment, status, id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, new_data, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'venue_management',
                `更新场地: ${name}`,
                'venue',
                id,
                JSON.stringify({ name: oldVenue.name, capacity: oldVenue.capacity, status: oldVenue.status }),
                JSON.stringify({ name, capacity, status }),
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '场地更新成功'
        });

    } catch (error) {
        console.error('更新场地错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 删除场地
exports.deleteVenue = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查场地是否存在
        const venues = await query(
            'SELECT name FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 检查是否有关联的课程
        const courses = await query(
            'SELECT id FROM courses WHERE venue_id = ?',
            [id]
        );

        if (courses.length > 0) {
            return res.status(400).json({
                success: false,
                message: '该场地已被课程使用，无法删除'
            });
        }

        // 删除场地（会级联删除时间表）
        await query('DELETE FROM venues WHERE id = ?', [id]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'delete',
                'venue_management',
                `删除场地: ${venues[0].name}`,
                'venue',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '场地删除成功'
        });

    } catch (error) {
        console.error('删除场地错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新场地时间表
exports.updateVenueSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const { schedules } = req.body;
        const adminId = req.user.id;

        if (!Array.isArray(schedules)) {
            return res.status(400).json({
                success: false,
                message: '时间表格式错误'
            });
        }

        // 检查场地是否存在
        const venues = await query(
            'SELECT name FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 开始事务
        await query('START TRANSACTION');

        try {
            // 删除原有时间表
            await query('DELETE FROM venue_schedules WHERE venue_id = ?', [id]);

            // 插入新时间表
            for (const schedule of schedules) {
                const { day_of_week, start_time, end_time, is_available, maintenance_reason } = schedule;
                
                await query(
                    `INSERT INTO venue_schedules (venue_id, day_of_week, start_time, end_time, is_available, maintenance_reason)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, day_of_week, start_time, end_time, is_available !== false, maintenance_reason]
                );
            }

            // 提交事务
            await query('COMMIT');

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'update',
                    'venue_management',
                    `更新场地时间表: ${venues[0].name}`,
                    'venue_schedule',
                    id,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            res.json({
                success: true,
                message: '场地时间表更新成功'
            });

        } catch (error) {
            // 回滚事务
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('更新场地时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 检查场地冲突
exports.checkVenueConflict = async (req, res) => {
    try {
        const { venue_id, day_of_week, start_time, end_time, exclude_course_id } = req.query;

        if (!venue_id || !day_of_week || !start_time || !end_time) {
            return res.status(400).json({
                success: false,
                message: '参数不完整'
            });
        }

        let whereClause = 'WHERE venue_id = ? AND day_of_week = ? AND status = "published"';
        let params = [venue_id, day_of_week];

        if (exclude_course_id) {
            whereClause += ' AND id != ?';
            params.push(exclude_course_id);
        }

        // 检查时间冲突的课程
        const conflicts = await query(
            `SELECT c.id, c.name, c.start_time, c.end_time, t.name as teacher_name
             FROM courses c
             LEFT JOIN teachers t ON c.teacher_id = t.id
             ${whereClause}
             AND ((c.start_time <= ? AND c.end_time > ?) OR (c.start_time < ? AND c.end_time >= ?))`,
            [...params, start_time, start_time, end_time, end_time]
        );

        res.json({
            success: true,
            data: {
                hasConflict: conflicts.length > 0,
                conflicts
            }
        });

    } catch (error) {
        console.error('检查场地冲突错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// ==================== 教师管理 ====================

// 获取教师列表
exports.getTeachers = async (req, res) => {
    try {
        const { page = 1, limit = 10, keyword, department, status } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (keyword) {
            whereConditions.push('(t.name LIKE ? OR t.employee_id LIKE ? OR t.email LIKE ?)');
            params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
        }

        if (department) {
            whereConditions.push('t.department = ?');
            params.push(department);
        }

        if (status) {
            whereConditions.push('t.status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total FROM teachers t ${whereClause}`,
            params
        );

        // 获取教师列表
        const teachers = await query(
            `SELECT t.*, 
                    COUNT(DISTINCT c.id) as course_count,
                    COUNT(DISTINCT tq.id) as qualification_count
             FROM teachers t
             LEFT JOIN courses c ON t.id = c.teacher_id AND c.status = 'published'
             LEFT JOIN teacher_qualifications tq ON t.id = tq.teacher_id AND tq.is_active = 1
             ${whereClause}
             GROUP BY t.id
             ORDER BY t.created_at DESC
             LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
            params
        );

        res.json({
            success: true,
            data: {
                list: teachers,
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('获取教师列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取教师详情
exports.getTeacher = async (req, res) => {
    try {
        const { id } = req.params;

        const teachers = await query(
            'SELECT * FROM teachers WHERE id = ?',
            [id]
        );

        if (teachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师不存在'
            });
        }

        // 获取教师资质
        const qualifications = await query(
            `SELECT * FROM teacher_qualifications 
             WHERE teacher_id = ? 
             ORDER BY qualification_level DESC, issue_date DESC`,
            [id]
        );

        // 获取教师课程
        const courses = await query(
            `SELECT c.*, v.name as venue_name
             FROM courses c
             LEFT JOIN venues v ON c.venue_id = v.id
             WHERE c.teacher_id = ?
             ORDER BY c.created_at DESC`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...teachers[0],
                qualifications,
                courses
            }
        });

    } catch (error) {
        console.error('获取教师详情错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 创建教师
exports.createTeacher = async (req, res) => {
    try {
        const { name, employee_id, department, title, phone, email, specialties, bio, status } = req.body;
        const adminId = req.user.id;

        if (!name || !employee_id || !department) {
            return res.status(400).json({
                success: false,
                message: '姓名、工号和部门不能为空'
            });
        }

        // 检查工号是否已存在
        const existingTeachers = await query(
            'SELECT id FROM teachers WHERE employee_id = ?',
            [employee_id]
        );

        if (existingTeachers.length > 0) {
            return res.status(400).json({
                success: false,
                message: '教师工号已存在'
            });
        }

        // 创建教师（同时设置 employee_id 和 teacher_id 以保持兼容性）
        const result = await query(
            `INSERT INTO teachers (name, employee_id, teacher_id, department, title, phone, email, specialties, bio, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, employee_id, employee_id, department, title, phone, email, specialties, bio, status || 'active']
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'teacher_management',
                `创建教师: ${name} (${employee_id})`,
                'teacher',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '教师创建成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('创建教师错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新教师
exports.updateTeacher = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, employee_id, department, title, phone, email, specialties, bio, status } = req.body;
        const adminId = req.user.id;

        // 检查教师是否存在
        const existingTeachers = await query(
            'SELECT * FROM teachers WHERE id = ?',
            [id]
        );

        if (existingTeachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师不存在'
            });
        }

        const oldTeacher = existingTeachers[0];

        // 检查工号冲突（排除自己）
        if (employee_id && employee_id !== oldTeacher.employee_id) {
            const employeeConflict = await query(
                'SELECT id FROM teachers WHERE employee_id = ? AND id != ?',
                [employee_id, id]
            );

            if (employeeConflict.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '教师工号已存在'
                });
            }
        }

        // 更新教师
        await query(
            `UPDATE teachers 
             SET name = ?, employee_id = ?, teacher_id = ?, department = ?, title = ?, phone = ?, email = ?, specialties = ?, bio = ?, status = ?, updated_at = NOW()
             WHERE id = ?`,
            [name, employee_id, employee_id, department, title, phone, email, specialties, bio, status, id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, new_data, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'teacher_management',
                `更新教师: ${name} (${employee_id})`,
                'teacher',
                id,
                JSON.stringify({ name: oldTeacher.name, status: oldTeacher.status }),
                JSON.stringify({ name, status }),
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '教师更新成功'
        });

    } catch (error) {
        console.error('更新教师错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 添加教师资质
exports.addTeacherQualification = async (req, res) => {
    try {
        const { teacher_id } = req.params;
        const { sport_category, qualification_level, certificate_name, certificate_number, issue_date, expire_date, issuing_authority } = req.body;
        const adminId = req.user.id;

        if (!sport_category || !qualification_level) {
            return res.status(400).json({
                success: false,
                message: '体育类别和资质等级不能为空'
            });
        }

        // 检查教师是否存在
        const teachers = await query(
            'SELECT name FROM teachers WHERE id = ?',
            [teacher_id]
        );

        if (teachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师不存在'
            });
        }

        // 添加资质
        const result = await query(
            `INSERT INTO teacher_qualifications 
             (teacher_id, sport_category, qualification_level, certificate_name, certificate_number, issue_date, expire_date, issuing_authority)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [teacher_id, sport_category, qualification_level, certificate_name, certificate_number, issue_date, expire_date, issuing_authority]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'teacher_management',
                `为教师 ${teachers[0].name} 添加资质: ${sport_category} ${qualification_level}`,
                'teacher_qualification',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '教师资质添加成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('添加教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新教师资质
exports.updateTeacherQualification = async (req, res) => {
    try {
        const { id } = req.params;
        const { sport_category, qualification_level, certificate_name, certificate_number, issue_date, expire_date, issuing_authority, is_active } = req.body;
        const adminId = req.user.id;

        // 检查资质是否存在
        const qualifications = await query(
            `SELECT tq.*, t.name as teacher_name 
             FROM teacher_qualifications tq
             LEFT JOIN teachers t ON tq.teacher_id = t.id
             WHERE tq.id = ?`,
            [id]
        );

        if (qualifications.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师资质不存在'
            });
        }

        // 更新资质
        await query(
            `UPDATE teacher_qualifications 
             SET sport_category = ?, qualification_level = ?, certificate_name = ?, certificate_number = ?, 
                 issue_date = ?, expire_date = ?, issuing_authority = ?, is_active = ?, updated_at = NOW()
             WHERE id = ?`,
            [sport_category, qualification_level, certificate_name, certificate_number, issue_date, expire_date, issuing_authority, is_active, id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'teacher_management',
                `更新教师 ${qualifications[0].teacher_name} 的资质: ${sport_category} ${qualification_level}`,
                'teacher_qualification',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '教师资质更新成功'
        });

    } catch (error) {
        console.error('更新教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 删除教师资质
exports.deleteTeacherQualification = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查资质是否存在
        const qualifications = await query(
            `SELECT tq.*, t.name as teacher_name 
             FROM teacher_qualifications tq
             LEFT JOIN teachers t ON tq.teacher_id = t.id
             WHERE tq.id = ?`,
            [id]
        );

        if (qualifications.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师资质不存在'
            });
        }

        const qualification = qualifications[0];

        // 删除资质
        await query('DELETE FROM teacher_qualifications WHERE id = ?', [id]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'delete',
                'teacher_management',
                `删除教师 ${qualification.teacher_name} 的资质: ${qualification.sport_category} ${qualification.qualification_level}`,
                'teacher_qualification',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '教师资质删除成功'
        });

    } catch (error) {
        console.error('删除教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// ==================== 场地时间表管理 ====================

// 获取场地时间表
exports.getVenueSchedules = async (req, res) => {
    try {
        const { id } = req.params;

        // 检查场地是否存在
        const venues = await query(
            'SELECT name, type, status FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 获取场地时间表
        const schedules = await query(
            `SELECT * FROM venue_schedules 
             WHERE venue_id = ? 
             ORDER BY day_of_week, start_time`,
            [id]
        );

        // 格式化为周视图数据
        const weeklySchedule = {};
        for (let day = 1; day <= 7; day++) {
            weeklySchedule[day] = schedules.filter(s => s.day_of_week === day);
        }

        res.json({
            success: true,
            data: {
                venue: venues[0],
                schedules,
                weeklySchedule
            }
        });

    } catch (error) {
        console.error('获取场地时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取单日时间表详情
exports.getDaySchedule = async (req, res) => {
    try {
        const { id, day } = req.params;
        const dayOfWeek = parseInt(day);

        // 验证参数
        if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
            return res.status(400).json({
                success: false,
                message: '无效的星期参数'
            });
        }

        // 检查场地是否存在
        const venues = await query(
            'SELECT name, type, status FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 获取该天的时间表
        const schedules = await query(
            `SELECT * FROM venue_schedules 
             WHERE venue_id = ? AND day_of_week = ?
             ORDER BY start_time`,
            [id, dayOfWeek]
        );

        res.json({
            success: true,
            data: {
                venue: venues[0],
                dayOfWeek,
                schedules
            }
        });

    } catch (error) {
        console.error('获取单日时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新单日时间表
exports.updateDaySchedule = async (req, res) => {
    try {
        const { id, day } = req.params;
        const { schedules } = req.body;
        const adminId = req.user.id;
        const dayOfWeek = parseInt(day);

        // 验证参数
        if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7) {
            return res.status(400).json({
                success: false,
                message: '无效的星期参数'
            });
        }

        if (!Array.isArray(schedules)) {
            return res.status(400).json({
                success: false,
                message: '时间表格式错误'
            });
        }

        // 验证时间段不重叠
        for (let i = 0; i < schedules.length; i++) {
            for (let j = i + 1; j < schedules.length; j++) {
                const slot1 = schedules[i];
                const slot2 = schedules[j];
                
                // 检查时间重叠
                if (
                    (slot1.start_time < slot2.end_time && slot1.end_time > slot2.start_time) ||
                    (slot2.start_time < slot1.end_time && slot2.end_time > slot1.start_time)
                ) {
                    return res.status(400).json({
                        success: false,
                        message: `时间段重叠: ${slot1.start_time}-${slot1.end_time} 与 ${slot2.start_time}-${slot2.end_time}`
                    });
                }
            }
        }

        // 检查场地是否存在
        const venues = await query(
            'SELECT name FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 开始事务
        await query('START TRANSACTION');

        try {
            // 删除该天原有的时间表
            await query(
                'DELETE FROM venue_schedules WHERE venue_id = ? AND day_of_week = ?',
                [id, dayOfWeek]
            );

            // 插入新的时间段
            for (const schedule of schedules) {
                const { start_time, end_time, is_available, maintenance_reason } = schedule;
                
                await query(
                    `INSERT INTO venue_schedules (venue_id, day_of_week, start_time, end_time, is_available, maintenance_reason)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, dayOfWeek, start_time, end_time, is_available !== false, maintenance_reason || null]
                );
            }

            // 提交事务
            await query('COMMIT');

            // 记录操作日志
            const dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, new_data, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'update',
                    'venue_management',
                    `更新场地${dayNames[dayOfWeek]}时间表: ${venues[0].name}`,
                    'venue_schedule',
                    id,
                    JSON.stringify({ dayOfWeek, schedules }),
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            res.json({
                success: true,
                message: '单日时间表更新成功'
            });

        } catch (error) {
            // 回滚事务
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('更新单日时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 批量设置场地开放时间
exports.batchSetVenueHours = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduleType, startTime, endTime, days, timeSlots } = req.body;
        const adminId = req.user.id;

        // 检查场地是否存在
        const venues = await query(
            'SELECT name FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 验证参数
        if (!scheduleType || (!Array.isArray(days) || days.length === 0)) {
            return res.status(400).json({
                success: false,
                message: '参数不完整'
            });
        }

        // 开始事务
        await query('START TRANSACTION');

        try {
            // 删除指定日期的原有时间表
            if (days.length > 0) {
                const dayPlaceholders = days.map(() => '?').join(',');
                await query(
                    `DELETE FROM venue_schedules WHERE venue_id = ? AND day_of_week IN (${dayPlaceholders})`,
                    [id, ...days]
                );
            }

            let schedules = [];

            if (scheduleType === 'simple') {
                // 简单模式：每天一个时间段
                for (const day of days) {
                    schedules.push({
                        venue_id: id,
                        day_of_week: day,
                        start_time: startTime,
                        end_time: endTime,
                        is_available: true
                    });
                }
            } else if (scheduleType === 'detailed') {
                // 详细模式：自定义时间段
                for (const day of days) {
                    for (const slot of timeSlots || []) {
                        schedules.push({
                            venue_id: id,
                            day_of_week: day,
                            start_time: slot.start_time,
                            end_time: slot.end_time,
                            is_available: slot.is_available !== false,
                            maintenance_reason: slot.maintenance_reason
                        });
                    }
                }
            }

            // 插入新时间表
            for (const schedule of schedules) {
                await query(
                    `INSERT INTO venue_schedules (venue_id, day_of_week, start_time, end_time, is_available, maintenance_reason)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [schedule.venue_id, schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.is_available, schedule.maintenance_reason]
                );
            }

            // 提交事务
            await query('COMMIT');

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'batch_update',
                    'venue_management',
                    `批量设置场地时间表: ${venues[0].name} (${days.join(',')})`,
                    'venue_schedule',
                    id,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            res.json({
                success: true,
                message: '场地开放时间设置成功'
            });

        } catch (error) {
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('批量设置场地开放时间错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 复制场地时间表模板
exports.copyVenueSchedule = async (req, res) => {
    try {
        const { sourceVenueId, targetVenueIds } = req.body;
        const adminId = req.user.id;

        if (!sourceVenueId || !Array.isArray(targetVenueIds) || targetVenueIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: '参数不完整'
            });
        }

        // 检查源场地是否存在
        const sourceVenue = await query(
            'SELECT name FROM venues WHERE id = ?',
            [sourceVenueId]
        );

        if (sourceVenue.length === 0) {
            return res.status(404).json({
                success: false,
                message: '源场地不存在'
            });
        }

        // 获取源场地的时间表
        const sourceSchedules = await query(
            'SELECT day_of_week, start_time, end_time, is_available, maintenance_reason FROM venue_schedules WHERE venue_id = ?',
            [sourceVenueId]
        );

        if (sourceSchedules.length === 0) {
            return res.status(400).json({
                success: false,
                message: '源场地没有时间表可复制'
            });
        }

        // 开始事务
        await query('START TRANSACTION');

        try {
            let successCount = 0;
            
            for (const targetVenueId of targetVenueIds) {
                // 检查目标场地是否存在
                const targetVenue = await query(
                    'SELECT name FROM venues WHERE id = ?',
                    [targetVenueId]
                );

                if (targetVenue.length === 0) {
                    continue; // 跳过不存在的场地
                }

                // 删除目标场地的原有时间表
                await query(
                    'DELETE FROM venue_schedules WHERE venue_id = ?',
                    [targetVenueId]
                );

                // 复制时间表
                for (const schedule of sourceSchedules) {
                    await query(
                        `INSERT INTO venue_schedules (venue_id, day_of_week, start_time, end_time, is_available, maintenance_reason)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [targetVenueId, schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.is_available, schedule.maintenance_reason]
                    );
                }
                
                successCount++;
            }

            // 提交事务
            await query('COMMIT');

            // 记录操作日志
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    adminId,
                    'copy',
                    'venue_management',
                    `复制场地时间表: 从 ${sourceVenue[0].name} 复制到 ${successCount} 个场地`,
                    'venue_schedule',
                    null,
                    req.ip || '',
                    req.get('User-Agent') || '',
                    'success'
                ]
            );

            res.json({
                success: true,
                message: `时间表复制成功，共复制到 ${successCount} 个场地`
            });

        } catch (error) {
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('复制场地时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取场地占用情况统计
exports.getVenueUsageStatistics = async (req, res) => {
    try {
        const { id } = req.params;
        const { week } = req.query; // 可选的周参数

        // 检查场地是否存在
        const venues = await query(
            'SELECT name, capacity FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 获取场地的课程安排
        const courses = await query(
            `SELECT c.id, c.name, c.day_of_week, c.start_time, c.end_time, c.enrolled_count, c.capacity,
                    t.name as teacher_name, c.weeks
             FROM courses c
             LEFT JOIN teachers t ON c.teacher_id = t.id
             WHERE c.venue_id = ? AND c.status = 'published'
             ORDER BY c.day_of_week, c.start_time`,
            [id]
        );

        // 获取场地开放时间表
        const schedules = await query(
            `SELECT day_of_week, start_time, end_time, is_available, maintenance_reason
             FROM venue_schedules 
             WHERE venue_id = ?
             ORDER BY day_of_week, start_time`,
            [id]
        );

        // 计算使用率
        const weeklyUsage = {};
        for (let day = 1; day <= 7; day++) {
            const daySchedules = schedules.filter(s => s.day_of_week === day && s.is_available);
            const dayCourses = courses.filter(c => c.day_of_week === day);
            
            let totalAvailableMinutes = 0;
            let totalUsedMinutes = 0;

            // 计算当天总的可用时间（分钟）
            daySchedules.forEach(schedule => {
                const start = new Date(`2000-01-01 ${schedule.start_time}`);
                const end = new Date(`2000-01-01 ${schedule.end_time}`);
                totalAvailableMinutes += (end - start) / (1000 * 60);
            });

            // 计算已使用时间
            dayCourses.forEach(course => {
                const start = new Date(`2000-01-01 ${course.start_time}`);
                const end = new Date(`2000-01-01 ${course.end_time}`);
                totalUsedMinutes += (end - start) / (1000 * 60);
            });

            weeklyUsage[day] = {
                dayOfWeek: day,
                totalAvailableMinutes,
                totalUsedMinutes,
                usageRate: totalAvailableMinutes > 0 ? (totalUsedMinutes / totalAvailableMinutes * 100).toFixed(1) : 0,
                courses: dayCourses,
                schedules: daySchedules
            };
        }

        res.json({
            success: true,
            data: {
                venue: venues[0],
                weeklyUsage,
                totalCourses: courses.length,
                totalSchedules: schedules.length
            }
        });

    } catch (error) {
        console.error('获取场地使用统计错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 清空场地时间表
exports.clearVenueSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查场地是否存在
        const venues = await query(
            'SELECT name FROM venues WHERE id = ?',
            [id]
        );

        if (venues.length === 0) {
            return res.status(404).json({
                success: false,
                message: '场地不存在'
            });
        }

        // 清空时间表
        await query('DELETE FROM venue_schedules WHERE venue_id = ?', [id]);

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'clear',
                'venue_management',
                `清空场地时间表: ${venues[0].name}`,
                'venue_schedule',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'success'
            ]
        );

        res.json({
            success: true,
            message: '场地时间表已清空'
        });

    } catch (error) {
        console.error('清空场地时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};