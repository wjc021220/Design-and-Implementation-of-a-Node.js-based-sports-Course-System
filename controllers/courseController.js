const { query } = require('../config/database');
const moment = require('moment');

// 获取体育类别列表
const getCategories = async (req, res) => {
    try {
        const categories = await query(
            'SELECT * FROM sport_categories ORDER BY sort_order ASC, id ASC'
        );

        res.json({
            success: true,
            data: categories
        });

    } catch (error) {
        console.error('获取体育类别错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取课程列表（支持筛选）
const getCourses = async (req, res) => {
    try {
        console.log('=== 获取课程列表 API 调用 ===');
        console.log('请求参数:', req.query);
        const {
            category_id,
            teacher_id,
            venue_id,
            day_of_week,
            search,
            page = 1,
            limit = 10
        } = req.query;

        let whereConditions = ["c.status = 'published'"];
        let params = [];

        // 构建筛选条件
        if (category_id) {
            whereConditions.push('c.category_id = ?');
            params.push(category_id);
        }

        if (teacher_id) {
            whereConditions.push('c.teacher_id = ?');
            params.push(teacher_id);
        }

        if (venue_id) {
            whereConditions.push('c.venue_id = ?');
            params.push(venue_id);
        }

        if (day_of_week) {
            whereConditions.push('c.day_of_week = ?');
            params.push(day_of_week);
        }

        if (search) {
            whereConditions.push('(c.name LIKE ? OR c.description LIKE ? OR t.name LIKE ?)');
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // 计算分页
        const offset = (page - 1) * limit;

        // 获取课程列表 - 简化查询
        const coursesQuery = `
            SELECT 
                c.id, c.course_code, c.name, c.credits, c.capacity, 
                IFNULL(c.enrolled_count, 0) as enrolled_count,
                c.day_of_week, c.start_time, c.end_time, c.weeks, c.description,
                c.selection_start_time, c.selection_end_time,
                sc.name as category_name, sc.icon as category_icon,
                t.name as teacher_name, t.title as teacher_title,
                v.name as venue_name, v.location as venue_location,
                (c.capacity - IFNULL(c.enrolled_count, 0)) as remaining_slots,
                'available' as selection_status
            FROM courses c
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            ${whereClause}
            ORDER BY c.id ASC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `;

        console.log('SQL查询:', coursesQuery);
        console.log('查询参数:', params);
        
        const courses = await query(coursesQuery, params);
        console.log('查询到的课程数量:', courses.length);

        // 获取总数
        const countQuery = `
            SELECT COUNT(*) as total
            FROM courses c
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            ${whereClause}
        `;

        const countResult = await query(countQuery, params);
        const total = countResult[0].total;

        // 如果用户已登录，获取用户的选课状态和收藏状态
        if (req.user) {
            const courseIds = courses.map(course => course.id);
            if (courseIds.length > 0) {
                // 获取选课状态
                const selections = await query(
                    `SELECT course_id, status FROM course_selections 
                     WHERE user_id = ? AND course_id IN (${courseIds.map(() => '?').join(',')})`,
                    [req.user.id, ...courseIds]
                );

                // 获取收藏状态
                const favorites = await query(
                    `SELECT course_id FROM course_favorites 
                     WHERE user_id = ? AND course_id IN (${courseIds.map(() => '?').join(',')})`,
                    [req.user.id, ...courseIds]
                );

                const selectionMap = {};
                selections.forEach(sel => {
                    selectionMap[sel.course_id] = sel.status;
                });

                const favoriteMap = {};
                favorites.forEach(fav => {
                    favoriteMap[fav.course_id] = true;
                });

                // 添加用户相关信息到课程数据
                courses.forEach(course => {
                    course.user_selection_status = selectionMap[course.id] || null;
                    course.is_favorited = favoriteMap[course.id] || false;
                });
            }
        }

        res.json({
            success: true,
            data: {
                courses,
                pagination: {
                    current_page: parseInt(page),
                    per_page: parseInt(limit),
                    total,
                    total_pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        console.error('=== 获取课程列表错误 ===');
        console.error('错误信息:', error.message);
        console.error('错误堆栈:', error.stack);
        console.error('错误类型:', error.code);
        
        res.status(500).json({
            success: false,
            message: '服务器内部错误: ' + error.message
        });
    }
};

// 获取课程详情
const getCourseDetail = async (req, res) => {
    try {
        const { id } = req.params;

        const courses = await query(`
            SELECT 
                c.*, 
                sc.name as category_name, sc.description as category_description,
                t.name as teacher_name, t.title as teacher_title, t.introduction as teacher_introduction,
                v.name as venue_name, v.location as venue_location, v.capacity as venue_capacity, v.equipment as venue_equipment,
                (c.capacity - c.enrolled_count) as remaining_slots,
                CASE 
                    WHEN NOW() < c.selection_start_time THEN 'not_started'
                    WHEN NOW() > c.selection_end_time THEN 'ended'
                    WHEN c.enrolled_count >= c.capacity THEN 'full'
                    ELSE 'available'
                END as selection_status
            FROM courses c
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            WHERE c.id = ? AND c.status = 'published'
        `, [id]);

        if (courses.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在'
            });
        }

        const course = courses[0];

        // 如果用户已登录，获取用户相关信息
        if (req.user) {
            // 获取选课状态
            const selections = await query(
                'SELECT status, selection_time FROM course_selections WHERE user_id = ? AND course_id = ?',
                [req.user.id, id]
            );

            // 获取收藏状态
            const favorites = await query(
                'SELECT id FROM course_favorites WHERE user_id = ? AND course_id = ?',
                [req.user.id, id]
            );

            course.user_selection_status = selections.length > 0 ? selections[0].status : null;
            course.user_selection_time = selections.length > 0 ? selections[0].selection_time : null;
            course.is_favorited = favorites.length > 0;
        }

        res.json({
            success: true,
            data: course
        });

    } catch (error) {
        console.error('获取课程详情错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取教师列表
const getTeachers = async (req, res) => {
    try {
        const teachers = await query(
            'SELECT id, name, title, department, introduction FROM teachers ORDER BY name ASC'
        );

        res.json({
            success: true,
            data: teachers
        });

    } catch (error) {
        console.error('获取教师列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取场地列表
const getVenues = async (req, res) => {
    try {
        const venues = await query(
            'SELECT id, name, location, capacity, equipment FROM venues WHERE status = "available" ORDER BY name ASC'
        );

        res.json({
            success: true,
            data: venues
        });

    } catch (error) {
        console.error('获取场地列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取课程时间表
const getCourseSchedule = async (req, res) => {
    try {
        const { week } = req.query; // 可选参数，指定查看哪一周

        const courses = await query(`
            SELECT 
                c.id, c.name, c.day_of_week, c.start_time, c.end_time,
                t.name as teacher_name,
                v.name as venue_name, v.location as venue_location,
                sc.name as category_name
            FROM courses c
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            WHERE c.status = 'published'
            ORDER BY c.day_of_week ASC, c.start_time ASC
        `);

        // 按星期几分组
        const schedule = {};
        for (let i = 1; i <= 7; i++) {
            schedule[i] = [];
        }

        courses.forEach(course => {
            schedule[course.day_of_week].push(course);
        });

        res.json({
            success: true,
            data: {
                schedule,
                week_names: {
                    1: '周一',
                    2: '周二',
                    3: '周三',
                    4: '周四',
                    5: '周五',
                    6: '周六',
                    7: '周日'
                }
            }
        });

    } catch (error) {
        console.error('获取课程时间表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

module.exports = {
    getCategories,
    getCourses,
    getCourseDetail,
    getTeachers,
    getVenues,
    getCourseSchedule
};
