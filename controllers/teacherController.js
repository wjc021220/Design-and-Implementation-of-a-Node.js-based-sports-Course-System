const { query } = require('../config/database');
const moment = require('moment');

// 设置moment中文
moment.locale('zh-cn');

// 获取教师的课程列表
const getTeacherCourses = async (req, res) => {
    try {
        console.log('=== 获取教师课程列表 ===');
        console.log('用户信息:', req.user);
        
        const teacherId = req.user.teacherId;
        const { page = 1, limit = 10, status, semester } = req.query;
        const offset = (page - 1) * limit;
        
        console.log('请求参数:', { teacherId, page, limit, status, semester, offset });

        let whereClause = 'WHERE c.teacher_id = ?';
        let queryParams = [teacherId];

        if (status) {
            whereClause += ' AND c.status = ?';
            queryParams.push(status);
        }

        if (semester) {
            whereClause += ' AND c.semester = ?';
            queryParams.push(semester);
        }

        const querySQL = `
            SELECT 
                c.*,
                sc.name as category_name,
                v.name as venue_name,
                v.location as venue_location,
                COALESCE(c.enrolled_count, 0) as enrolled_count
            FROM courses c
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN venues v ON c.venue_id = v.id
            ${whereClause}
            ORDER BY c.created_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `;

        console.log('教师课程查询SQL:', querySQL);
        console.log('教师课程查询参数:', queryParams);

        const courses = await query(querySQL, queryParams);

        // 获取总数
        const countQuery = `
            SELECT COUNT(*) as total
            FROM courses c
            ${whereClause}
        `;
        const countResult = await query(countQuery, queryParams);
        const total = countResult[0].total;

        res.json({
            success: true,
            data: {
                courses,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        console.error('=== 获取教师课程列表错误 ===');
        console.error('错误信息:', error.message);
        console.error('错误堆栈:', error.stack);
        console.error('错误类型:', error.code);
        
        res.status(500).json({
            success: false,
            message: '服务器内部错误: ' + error.message
        });
    }
};

// 创建新课程
const createCourse = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const {
            course_code,
            name,
            category_id,
            venue_id,
            credits,
            capacity,
            day_of_week,
            start_time,
            end_time,
            weeks,
            syllabus,
            assessment_method,
            requirements,
            description,
            semester,
            academic_year
        } = req.body;

        // 验证必填字段
        if (!course_code || !name || !category_id || !venue_id || !capacity || !day_of_week || !start_time || !end_time) {
            return res.status(400).json({
                success: false,
                message: '请填写所有必填字段'
            });
        }

        // 检查课程代码是否已存在
        const existingCourse = await query(
            'SELECT id FROM courses WHERE course_code = ?',
            [course_code]
        );

        if (existingCourse.length > 0) {
            return res.status(400).json({
                success: false,
                message: '课程代码已存在'
            });
        }

        // 检查时间冲突（同一教师、同一时间段）
        const timeConflictQuery = `
            SELECT id FROM courses 
            WHERE teacher_id = ? 
            AND day_of_week = ? 
            AND status != 'closed'
            AND (
                (start_time <= ? AND end_time > ?) OR
                (start_time < ? AND end_time >= ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        `;

        const conflictCourses = await query(timeConflictQuery, [
            teacherId, day_of_week, start_time, start_time, end_time, end_time, start_time, end_time
        ]);

        if (conflictCourses.length > 0) {
            return res.status(400).json({
                success: false,
                message: '该时间段与您的其他课程冲突'
            });
        }

        // 插入新课程
        const insertQuery = `
            INSERT INTO courses (
                course_code, name, category_id, teacher_id, venue_id, credits, capacity,
                day_of_week, start_time, end_time, weeks, syllabus, assessment_method,
                requirements, description, status, semester, academic_year
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        `;

        const result = await query(insertQuery, [
            course_code, name, category_id, teacherId, venue_id, credits || 2, capacity,
            day_of_week, start_time, end_time, weeks, syllabus, assessment_method,
            requirements, description, semester, academic_year
        ]);

        res.json({
            success: true,
            message: '课程创建成功',
            data: { courseId: result.insertId }
        });

    } catch (error) {
        console.error('创建课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新课程信息
const updateCourse = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.id;
        const updateData = req.body;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id, status FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限修改'
            });
        }

        // 如果课程已发布且有学生选课，限制某些字段的修改
        if (course[0].status === 'published') {
            const selections = await query(
                'SELECT COUNT(*) as count FROM course_selections WHERE course_id = ? AND status = "selected"',
                [courseId]
            );

            if (selections[0].count > 0) {
                // 已有学生选课，不允许修改关键信息
                const restrictedFields = ['capacity', 'day_of_week', 'start_time', 'end_time', 'venue_id'];
                const hasRestrictedChanges = restrictedFields.some(field => updateData.hasOwnProperty(field));

                if (hasRestrictedChanges) {
                    return res.status(400).json({
                        success: false,
                        message: '课程已有学生选课，不能修改时间、地点和容量等关键信息'
                    });
                }
            }
        }

        // 构建更新查询
        const allowedFields = [
            'name', 'category_id', 'venue_id', 'credits', 'capacity',
            'day_of_week', 'start_time', 'end_time', 'weeks', 'syllabus',
            'assessment_method', 'requirements', 'description'
        ];

        const updateFields = [];
        const updateValues = [];

        allowedFields.forEach(field => {
            if (updateData.hasOwnProperty(field)) {
                updateFields.push(`${field} = ?`);
                updateValues.push(updateData[field]);
            }
        });

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: '没有需要更新的字段'
            });
        }

        updateValues.push(courseId);

        const updateQuery = `
            UPDATE courses 
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE id = ?
        `;

        await query(updateQuery, updateValues);

        res.json({
            success: true,
            message: '课程信息更新成功'
        });

    } catch (error) {
        console.error('更新课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 发布课程
const publishCourse = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.id;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id, status FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限操作'
            });
        }

        if (course[0].status === 'published') {
            return res.status(400).json({
                success: false,
                message: '课程已经发布'
            });
        }

        // 更新课程状态为已发布
        await query(
            'UPDATE courses SET status = "published", updated_at = NOW() WHERE id = ?',
            [courseId]
        );

        res.json({
            success: true,
            message: '课程发布成功'
        });

    } catch (error) {
        console.error('发布课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 关闭课程
const closeCourse = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.id;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限操作'
            });
        }

        // 更新课程状态为已关闭
        await query(
            'UPDATE courses SET status = "closed", updated_at = NOW() WHERE id = ?',
            [courseId]
        );

        res.json({
            success: true,
            message: '课程已关闭'
        });

    } catch (error) {
        console.error('关闭课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 重新开启课程
const openCourse = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.id;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限操作'
            });
        }

        // 更新课程状态为已发布
        await query(
            'UPDATE courses SET status = "published", updated_at = NOW() WHERE id = ?',
            [courseId]
        );

        res.json({
            success: true,
            message: '课程已重新开启'
        });

    } catch (error) {
        console.error('开启课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取课程的学生名单
const getCourseStudents = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.id;
        const { status = 'selected' } = req.query;

        // 验证课程是否属于当前教师并获取完整课程信息
        const course = await query(
            `SELECT c.*, sc.name as category_name, v.name as venue_name, v.location as venue_location
             FROM courses c
             LEFT JOIN sport_categories sc ON c.category_id = sc.id
             LEFT JOIN venues v ON c.venue_id = v.id
             WHERE c.id = ? AND c.teacher_id = ?`,
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限查看'
            });
        }

        // 获取学生名单
        const studentsQuery = `
            SELECT 
                u.id as user_id,
                u.student_id,
                u.real_name,
                u.gender,
                u.email,
                u.phone,
                u.grade,
                u.major,
                u.class_name,
                cs.status,
                cs.selection_time,
                cs.updated_at
            FROM course_selections cs
            JOIN users u ON cs.user_id = u.id
            WHERE cs.course_id = ? AND cs.status = ?
            ORDER BY cs.selection_time ASC
        `;

        const students = await query(studentsQuery, [courseId, status]);

        res.json({
            success: true,
            data: {
                course: course[0],
                students,
                total: students.length
            }
        });

    } catch (error) {
        console.error('获取学生名单错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 删除课程
const deleteCourse = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.id;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id, status FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限删除'
            });
        }

        // 检查是否有学生选课
        const selections = await query(
            'SELECT COUNT(*) as count FROM course_selections WHERE course_id = ?',
            [courseId]
        );

        if (selections[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: '课程已有学生选课，无法删除'
            });
        }

        // 删除课程
        await query('DELETE FROM courses WHERE id = ?', [courseId]);

        res.json({
            success: true,
            message: '课程删除成功'
        });

    } catch (error) {
        console.error('删除课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取教师工作台数据
const getDashboardData = async (req, res) => {
    try {
        console.log('=== 获取教师工作台数据 ===');
        const teacherId = req.user.teacherId;
        console.log('教师ID:', teacherId);

        // 获取课程统计
        const courseStats = await query(`
            SELECT 
                COUNT(*) as total_courses,
                SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published_courses,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_courses,
                SUM(COALESCE(enrolled_count, 0)) as total_students
            FROM courses 
            WHERE teacher_id = ?
        `, [teacherId]);

        // 获取最近的课程活动
        const recentCourses = await query(`
            SELECT 
                c.name,
                c.status,
                c.created_at,
                c.updated_at,
                COALESCE(c.enrolled_count, 0) as enrolled_count,
                c.capacity
            FROM courses c
            WHERE c.teacher_id = ?
            ORDER BY c.updated_at DESC
            LIMIT 5
        `, [teacherId]);

        // 获取选课申请统计（如果有相关表）
        let pendingApplications = 0;
        try {
            const appStats = await query(`
                SELECT COUNT(*) as count
                FROM special_applications sa
                JOIN courses c ON sa.course_id = c.id
                WHERE c.teacher_id = ? AND sa.status = 'pending'
            `, [teacherId]);
            pendingApplications = appStats[0]?.count || 0;
        } catch (error) {
            console.log('特殊申请表不存在，跳过统计');
        }

        const stats = courseStats[0] || {
            total_courses: 0,
            published_courses: 0,
            draft_courses: 0,
            total_students: 0
        };

        // 构建活动列表
        const activities = recentCourses.map(course => {
            const isNew = new Date(course.created_at).getTime() === new Date(course.updated_at).getTime();
            return {
                id: Math.random().toString(36).substr(2, 9),
                content: isNew ? `创建了课程"${course.name}"` : `更新了课程"${course.name}"`,
                time: moment(course.updated_at).format('YYYY-MM-DD HH:mm'),
                type: course.status === 'published' ? 'success' : 'info'
            };
        });

        const dashboardData = {
            stats: {
                totalCourses: stats.total_courses,
                publishedCourses: stats.published_courses,
                draftCourses: stats.draft_courses,
                totalStudents: stats.total_students,
                pendingApplications
            },
            recentActivities: activities
        };

        console.log('工作台数据:', dashboardData);

        res.json({
            success: true,
            data: dashboardData
        });

    } catch (error) {
        console.error('=== 获取教师工作台数据错误 ===');
        console.error('错误信息:', error.message);
        console.error('错误堆栈:', error.stack);
        
        res.status(500).json({
            success: false,
            message: '服务器内部错误: ' + error.message
        });
    }
};

module.exports = {
    getDashboardData,
    getTeacherCourses,
    createCourse,
    updateCourse,
    publishCourse,
    closeCourse,
    openCourse,
    getCourseStudents,
    deleteCourse
};
