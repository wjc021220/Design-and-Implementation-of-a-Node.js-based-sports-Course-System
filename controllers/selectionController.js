const { query, transaction } = require('../config/database');
const moment = require('moment');

// 检查选课时间是否开放
const checkSelectionPeriod = async () => {
    try {
        // 首先检查新的course_selection_config表
        const configs = await query(`
            SELECT * FROM course_selection_config 
            WHERE status = 'active' 
            AND start_time <= NOW() 
            AND end_time >= NOW()
            ORDER BY created_at DESC 
            LIMIT 1
        `);

        if (configs.length > 0) {
            const config = configs[0];
            const now = moment();
            const startTime = moment(config.start_time);
            const endTime = moment(config.end_time);

            if (now.isBetween(startTime, endTime)) {
                return { 
                    isOpen: true, 
                    period: 'selection', 
                    message: config.description || '选课期间',
                    config: config
                };
            }
        }

        // 兼容旧的system_config表（备用方案）
        const oldConfig = await query(
            'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?, ?)',
            ['selection_period_1_start', 'selection_period_1_end', 'makeup_selection_start', 'makeup_selection_end']
        );

        if (oldConfig.length > 0) {
            const configMap = {};
            oldConfig.forEach(item => {
                configMap[item.config_key] = item.config_value;
            });

            const now = moment();
            const period1Start = moment(configMap.selection_period_1_start);
            const period1End = moment(configMap.selection_period_1_end);
            const makeupStart = moment(configMap.makeup_selection_start);
            const makeupEnd = moment(configMap.makeup_selection_end);

            if (now.isBetween(period1Start, period1End)) {
                return { isOpen: true, period: 'selection', message: '选课期间' };
            } else if (now.isBetween(makeupStart, makeupEnd)) {
                return { isOpen: true, period: 'makeup', message: '补退选期间' };
            }
        }

        return { isOpen: false, period: 'closed', message: '选课未开放' };

    } catch (error) {
        console.error('检查选课时间失败:', error);
        return { isOpen: false, period: 'closed', message: '检查选课时间失败' };
    }
};

// 检查时间冲突
const checkTimeConflict = async (userId, courseId, excludeCourseId = null) => {
    try {
        // 获取要选择的课程时间
        const targetCourse = await query(
            'SELECT day_of_week, start_time, end_time FROM courses WHERE id = ?',
            [courseId]
        );

        if (targetCourse.length === 0) {
            return { hasConflict: true, message: '课程不存在' };
        }

        const { day_of_week, start_time, end_time } = targetCourse[0];

        // 查找用户已选择的课程中是否有时间冲突
        let conflictQuery = `
            SELECT c.name, c.day_of_week, c.start_time, c.end_time
            FROM course_selections cs
            JOIN courses c ON cs.course_id = c.id
            WHERE cs.user_id = ? 
            AND cs.status IN ('selected', 'pending')
            AND c.day_of_week = ?
            AND (
                (c.start_time <= ? AND c.end_time > ?) OR
                (c.start_time < ? AND c.end_time >= ?) OR
                (c.start_time >= ? AND c.end_time <= ?)
            )
        `;

        let params = [userId, day_of_week, start_time, start_time, end_time, end_time, start_time, end_time];

        if (excludeCourseId) {
            conflictQuery += ' AND c.id != ?';
            params.push(excludeCourseId);
        }

        const conflicts = await query(conflictQuery, params);

        if (conflicts.length > 0) {
            return {
                hasConflict: true,
                message: `与课程"${conflicts[0].name}"时间冲突`,
                conflictCourse: conflicts[0]
            };
        }

        return { hasConflict: false };

    } catch (error) {
        console.error('检查时间冲突错误:', error);
        return { hasConflict: true, message: '检查冲突时发生错误' };
    }
};

// 检查学分冲突
const checkCreditConflict = async (userId, courseId) => {
    try {
        // 获取用户学分上限
        const userInfo = await query('SELECT credit_limit FROM users WHERE id = ?', [userId]);
        if (userInfo.length === 0) {
            return { hasConflict: true, message: '用户不存在' };
        }

        const creditLimit = userInfo[0].credit_limit;

        // 获取要选择的课程学分
        const courseInfo = await query('SELECT credits FROM courses WHERE id = ?', [courseId]);
        if (courseInfo.length === 0) {
            return { hasConflict: true, message: '课程不存在' };
        }

        const courseCredits = courseInfo[0].credits;

        // 计算用户已选课程的总学分
        const selectedCredits = await query(`
            SELECT COALESCE(SUM(c.credits), 0) as total_credits
            FROM course_selections cs
            JOIN courses c ON cs.course_id = c.id
            WHERE cs.user_id = ? AND cs.status IN ('selected', 'pending')
        `, [userId]);

        const currentCredits = selectedCredits[0].total_credits;
        const newTotalCredits = currentCredits + courseCredits;

        if (newTotalCredits > creditLimit) {
            return {
                hasConflict: true,
                message: `选课学分超限，当前已选${currentCredits}学分，课程${courseCredits}学分，超出上限${creditLimit}学分`
            };
        }

        return { hasConflict: false };

    } catch (error) {
        console.error('检查学分冲突错误:', error);
        return { hasConflict: true, message: '检查学分冲突时发生错误' };
    }
};

// 选课操作
const selectCourse = async (req, res) => {
    try {
        const userId = req.user.id;
        const { course_id } = req.body;

        if (!course_id) {
            return res.status(400).json({
                success: false,
                message: '课程ID不能为空'
            });
        }

        // 检查选课时间
        const periodCheck = await checkSelectionPeriod();
        if (!periodCheck.isOpen) {
            return res.status(400).json({
                success: false,
                message: periodCheck.message
            });
        }

        // 检查课程是否存在且可选
        const courses = await query(`
            SELECT id, name, capacity, enrolled_count, status, selection_start_time, selection_end_time
            FROM courses 
            WHERE id = ? AND status = 'published'
        `, [course_id]);

        if (courses.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或未发布'
            });
        }

        const course = courses[0];

        // 检查课程选课时间
        const now = moment();
        if (course.selection_start_time && now.isBefore(moment(course.selection_start_time))) {
            return res.status(400).json({
                success: false,
                message: '课程选课尚未开始'
            });
        }

        if (course.selection_end_time && now.isAfter(moment(course.selection_end_time))) {
            return res.status(400).json({
                success: false,
                message: '课程选课已结束'
            });
        }

        // 检查是否已经选择过该课程
        const existingSelection = await query(
            'SELECT status FROM course_selections WHERE user_id = ? AND course_id = ?',
            [userId, course_id]
        );

        if (existingSelection.length > 0) {
            const status = existingSelection[0].status;
            const statusMap = {
                'pending': '已选择该课程，等待处理',
                'selected': '已选择该课程',
                'lottery': '该课程正在抽签中',
                'failed': '该课程选课失败，可重新选择',
                'dropped': '该课程已退选，可重新选择'
            };

            if (status === 'failed' || status === 'dropped') {
                // 可以重新选择
            } else {
                return res.status(400).json({
                    success: false,
                    message: statusMap[status] || '课程状态异常'
                });
            }
        }

        // 检查时间冲突
        const timeConflict = await checkTimeConflict(userId, course_id);
        if (timeConflict.hasConflict) {
            return res.status(400).json({
                success: false,
                message: timeConflict.message
            });
        }

        // 检查学分冲突
        const creditConflict = await checkCreditConflict(userId, course_id);
        if (creditConflict.hasConflict) {
            return res.status(400).json({
                success: false,
                message: creditConflict.message
            });
        }

        // 使用事务处理选课
        const result = await transaction(async (connection) => {
            // 检查课程容量（加锁防止并发问题）
            const [courseForUpdate] = await connection.execute(
                'SELECT capacity, enrolled_count FROM courses WHERE id = ? FOR UPDATE',
                [course_id]
            );

            if (courseForUpdate.length === 0) {
                throw new Error('课程不存在');
            }

            const currentCourse = courseForUpdate[0];
            
            // 插入或更新选课记录
            if (existingSelection.length > 0) {
                // 更新现有记录
                await connection.execute(
                    'UPDATE course_selections SET status = ?, selection_time = CURRENT_TIMESTAMP WHERE user_id = ? AND course_id = ?',
                    ['pending', userId, course_id]
                );
            } else {
                // 插入新记录
                await connection.execute(
                    'INSERT INTO course_selections (user_id, course_id, status, selection_time) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                    [userId, course_id, 'pending']
                );
            }

            // 如果课程未满，直接选中；如果已满，进入抽签状态
            let finalStatus = 'pending';
            if (currentCourse.enrolled_count < currentCourse.capacity) {
                finalStatus = 'selected';
                // 更新课程已选人数
                await connection.execute(
                    'UPDATE courses SET enrolled_count = enrolled_count + 1 WHERE id = ?',
                    [course_id]
                );
                
                // 更新选课状态
                await connection.execute(
                    'UPDATE course_selections SET status = ?, result_time = CURRENT_TIMESTAMP WHERE user_id = ? AND course_id = ?',
                    [finalStatus, userId, course_id]
                );
            } else {
                finalStatus = 'lottery';
                await connection.execute(
                    'UPDATE course_selections SET status = ? WHERE user_id = ? AND course_id = ?',
                    [finalStatus, userId, course_id]
                );
            }

            // 记录选课历史
            await connection.execute(
                'INSERT INTO selection_history (user_id, course_id, action, semester, academic_year) VALUES (?, ?, ?, ?, ?)',
                [userId, course_id, 'select', '2026春', '2025-2026']
            );

            return { finalStatus };
        });

        const statusMessages = {
            'selected': '选课成功',
            'lottery': '课程已满，已加入抽签队列',
            'pending': '选课申请已提交'
        };

        res.json({
            success: true,
            message: statusMessages[result.finalStatus] || '选课申请已提交',
            data: {
                course_id,
                status: result.finalStatus
            }
        });

    } catch (error) {
        console.error('选课错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '服务器内部错误'
        });
    }
};

// 退选操作
const dropCourse = async (req, res) => {
    try {
        const userId = req.user.id;
        const { course_id } = req.body;

        if (!course_id) {
            return res.status(400).json({
                success: false,
                message: '课程ID不能为空'
            });
        }

        // 检查选课记录
        const selections = await query(
            'SELECT status FROM course_selections WHERE user_id = ? AND course_id = ?',
            [userId, course_id]
        );

        if (selections.length === 0) {
            return res.status(404).json({
                success: false,
                message: '未找到选课记录'
            });
        }

        const currentStatus = selections[0].status;

        if (currentStatus === 'dropped') {
            return res.status(400).json({
                success: false,
                message: '课程已经退选'
            });
        }

        if (currentStatus === 'failed') {
            return res.status(400).json({
                success: false,
                message: '课程选课失败，无需退选'
            });
        }

        // 使用事务处理退选
        await transaction(async (connection) => {
            // 更新选课状态为已退选
            await connection.execute(
                'UPDATE course_selections SET status = ?, result_time = CURRENT_TIMESTAMP WHERE user_id = ? AND course_id = ?',
                ['dropped', userId, course_id]
            );

            // 如果之前是已选中状态，需要减少课程的已选人数
            if (currentStatus === 'selected') {
                await connection.execute(
                    'UPDATE courses SET enrolled_count = enrolled_count - 1 WHERE id = ?',
                    [course_id]
                );
            }

            // 记录退选历史
            await connection.execute(
                'INSERT INTO selection_history (user_id, course_id, action, semester, academic_year) VALUES (?, ?, ?, ?, ?)',
                [userId, course_id, 'drop', '2026春', '2025-2026']
            );
        });

        res.json({
            success: true,
            message: '退选成功'
        });

    } catch (error) {
        console.error('退选错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取我的选课列表
const getMySelections = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status } = req.query; // 可选筛选状态

        let whereClause = 'WHERE cs.user_id = ?';
        let params = [userId];

        if (status) {
            whereClause += ' AND cs.status = ?';
            params.push(status);
        }

        const selections = await query(`
            SELECT 
                cs.id, cs.status, cs.selection_time, cs.result_time, cs.remarks,
                c.id as course_id, c.course_code, c.name as course_name, c.credits,
                c.day_of_week, c.start_time, c.end_time, c.weeks,
                sc.name as category_name,
                t.name as teacher_name,
                v.name as venue_name, v.location as venue_location
            FROM course_selections cs
            JOIN courses c ON cs.course_id = c.id
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            ${whereClause}
            ORDER BY cs.selection_time DESC
        `, params);

        // 统计各状态的数量
        const statusCounts = await query(`
            SELECT status, COUNT(*) as count
            FROM course_selections
            WHERE user_id = ?
            GROUP BY status
        `, [userId]);

        const statusCountMap = {};
        statusCounts.forEach(item => {
            statusCountMap[item.status] = item.count;
        });

        res.json({
            success: true,
            data: {
                selections,
                status_counts: statusCountMap
            }
        });

    } catch (error) {
        console.error('获取选课列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 收藏课程
const favoriteCourse = async (req, res) => {
    try {
        const userId = req.user.id;
        const { course_id } = req.body;

        if (!course_id) {
            return res.status(400).json({
                success: false,
                message: '课程ID不能为空'
            });
        }

        // 检查课程是否存在
        const courses = await query('SELECT id FROM courses WHERE id = ? AND status = "published"', [course_id]);
        if (courses.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在'
            });
        }

        // 检查是否已收藏
        const existing = await query(
            'SELECT id FROM course_favorites WHERE user_id = ? AND course_id = ?',
            [userId, course_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: '课程已收藏'
            });
        }

        // 添加收藏
        await query(
            'INSERT INTO course_favorites (user_id, course_id) VALUES (?, ?)',
            [userId, course_id]
        );

        res.json({
            success: true,
            message: '收藏成功'
        });

    } catch (error) {
        console.error('收藏课程错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 取消收藏课程
const unfavoriteCourse = async (req, res) => {
    try {
        const userId = req.user.id;
        // 支持从 body 或 query 参数读取
        const course_id = req.body.course_id || req.query.course_id;
        
        console.log('取消收藏请求:', {
            body: req.body,
            query: req.query,
            course_id: course_id,
            userId: req.user.id
        });

        if (!course_id) {
            return res.status(400).json({
                success: false,
                message: '课程ID不能为空'
            });
        }

        // 删除收藏记录
        const result = await query(
            'DELETE FROM course_favorites WHERE user_id = ? AND course_id = ?',
            [userId, course_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: '收藏记录不存在'
            });
        }

        res.json({
            success: true,
            message: '取消收藏成功'
        });

    } catch (error) {
        console.error('取消收藏错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取收藏的课程列表
const getFavoriteCourses = async (req, res) => {
    try {
        const userId = req.user.id;

        const favorites = await query(`
            SELECT 
                cf.created_at as favorite_time,
                c.id, c.course_code, c.name, c.credits, c.capacity, c.enrolled_count,
                c.day_of_week, c.start_time, c.end_time, c.weeks, c.description,
                sc.name as category_name, sc.icon as category_icon,
                t.name as teacher_name, t.title as teacher_title,
                v.name as venue_name, v.location as venue_location,
                (c.capacity - c.enrolled_count) as remaining_slots,
                true as is_favorited,
                CASE 
                    WHEN NOW() < c.selection_start_time THEN 'not_started'
                    WHEN NOW() > c.selection_end_time THEN 'ended'
                    WHEN c.enrolled_count >= c.capacity THEN 'full'
                    ELSE 'available'
                END as selection_status
            FROM course_favorites cf
            JOIN courses c ON cf.course_id = c.id
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            LEFT JOIN venues v ON c.venue_id = v.id
            WHERE cf.user_id = ? AND c.status = 'published'
            ORDER BY cf.created_at DESC
        `, [userId]);

        res.json({
            success: true,
            data: favorites
        });

    } catch (error) {
        console.error('获取收藏列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取选课历史
const getSelectionHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { semester, academic_year } = req.query;

        let whereClause = 'WHERE sh.user_id = ?';
        let params = [userId];

        if (semester) {
            whereClause += ' AND sh.semester = ?';
            params.push(semester);
        }

        if (academic_year) {
            whereClause += ' AND sh.academic_year = ?';
            params.push(academic_year);
        }

        const history = await query(`
            SELECT 
                sh.action, sh.action_time, sh.semester, sh.academic_year, sh.remarks,
                c.course_code, c.name as course_name, c.credits,
                sc.name as category_name,
                t.name as teacher_name
            FROM selection_history sh
            JOIN courses c ON sh.course_id = c.id
            LEFT JOIN sport_categories sc ON c.category_id = sc.id
            LEFT JOIN teachers t ON c.teacher_id = t.id
            ${whereClause}
            ORDER BY sh.action_time DESC
        `, params);

        res.json({
            success: true,
            data: history
        });

    } catch (error) {
        console.error('获取选课历史错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

module.exports = {
    selectCourse,
    dropCourse,
    getMySelections,
    favoriteCourse,
    unfavoriteCourse,
    getFavoriteCourses,
    getSelectionHistory,
    checkTimeConflict,
    checkCreditConflict
};
