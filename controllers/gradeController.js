const { query } = require('../config/database');
const moment = require('moment');

// 获取课程学生成绩列表
const getCourseGrades = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.courseId;
        const { semester, academic_year } = req.query;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id, name FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限查看'
            });
        }

        // 获取选课学生及其成绩
        let sql = `
            SELECT 
                u.id as student_id,
                u.student_id as student_number,
                u.real_name,
                u.grade,
                u.major,
                u.class_name,
                sg.id as grade_id,
                sg.attendance_score,
                sg.performance_score,
                sg.midterm_score,
                sg.final_score,
                sg.total_score,
                sg.grade_level,
                sg.is_submitted,
                sg.submit_time,
                sg.remarks,
                sg.semester,
                sg.academic_year
            FROM course_selections cs
            JOIN users u ON cs.user_id = u.id
            LEFT JOIN student_grades sg ON sg.course_id = cs.course_id AND sg.student_id = u.id
        `;

        let queryParams = [courseId];
        let whereClause = 'WHERE cs.course_id = ? AND cs.status = "selected"';

        if (semester && academic_year) {
            whereClause += ' AND (sg.semester = ? AND sg.academic_year = ? OR sg.semester IS NULL)';
            queryParams.push(semester, academic_year);
        }

        sql += ` ${whereClause} ORDER BY u.student_id`;

        const students = await query(sql, queryParams);

        res.json({
            success: true,
            data: {
                course: course[0],
                students,
                total: students.length
            }
        });

    } catch (error) {
        console.error('获取课程成绩错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 录入或更新学生成绩
const updateStudentGrade = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const { courseId, studentId } = req.params;
        const {
            attendance_score,
            performance_score,
            midterm_score,
            final_score,
            remarks,
            semester,
            academic_year
        } = req.body;

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

        // 验证学生是否选了这门课
        const selection = await query(
            'SELECT id FROM course_selections WHERE course_id = ? AND user_id = ? AND status = "selected"',
            [courseId, studentId]
        );

        if (selection.length === 0) {
            return res.status(400).json({
                success: false,
                message: '学生未选择此课程'
            });
        }

        // 计算总成绩（可以根据实际需求调整权重）
        const attendanceWeight = 0.2;  // 出勤20%
        const performanceWeight = 0.3; // 平时表现30%
        const midtermWeight = 0.2;     // 期中20%
        const finalWeight = 0.3;       // 期末30%

        let total_score = 0;
        let scoreCount = 0;

        if (attendance_score !== undefined && attendance_score !== null) {
            total_score += attendance_score * attendanceWeight;
            scoreCount++;
        }
        if (performance_score !== undefined && performance_score !== null) {
            total_score += performance_score * performanceWeight;
            scoreCount++;
        }
        if (midterm_score !== undefined && midterm_score !== null) {
            total_score += midterm_score * midtermWeight;
            scoreCount++;
        }
        if (final_score !== undefined && final_score !== null) {
            total_score += final_score * finalWeight;
            scoreCount++;
        }

        // 如果所有成绩都有，才计算总分
        if (scoreCount === 4) {
            total_score = Math.round(total_score * 100) / 100; // 保留两位小数
        } else {
            total_score = null;
        }

        // 根据总分确定等级
        let grade_level = null;
        if (total_score !== null) {
            if (total_score >= 90) grade_level = 'A';
            else if (total_score >= 80) grade_level = 'B';
            else if (total_score >= 70) grade_level = 'C';
            else if (total_score >= 60) grade_level = 'D';
            else grade_level = 'F';
        }

        // 检查成绩记录是否已存在
        const existingGrade = await query(
            'SELECT id FROM student_grades WHERE course_id = ? AND student_id = ? AND semester = ? AND academic_year = ?',
            [courseId, studentId, semester, academic_year]
        );

        if (existingGrade.length > 0) {
            // 更新现有成绩
            const updateQuery = `
                UPDATE student_grades 
                SET attendance_score = ?, performance_score = ?, midterm_score = ?, 
                    final_score = ?, total_score = ?, grade_level = ?, remarks = ?,
                    updated_at = NOW()
                WHERE id = ?
            `;

            await query(updateQuery, [
                attendance_score, performance_score, midterm_score, final_score,
                total_score, grade_level, remarks, existingGrade[0].id
            ]);
        } else {
            // 插入新成绩记录
            const insertQuery = `
                INSERT INTO student_grades (
                    course_id, student_id, attendance_score, performance_score,
                    midterm_score, final_score, total_score, grade_level,
                    remarks, semester, academic_year
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await query(insertQuery, [
                courseId, studentId, attendance_score, performance_score,
                midterm_score, final_score, total_score, grade_level,
                remarks, semester, academic_year
            ]);
        }

        res.json({
            success: true,
            message: '成绩录入成功',
            data: {
                total_score,
                grade_level
            }
        });

    } catch (error) {
        console.error('录入成绩错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 批量录入成绩
const batchUpdateGrades = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.courseId;
        const { grades, semester, academic_year } = req.body;

        if (!Array.isArray(grades) || grades.length === 0) {
            return res.status(400).json({
                success: false,
                message: '成绩数据格式错误'
            });
        }

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

        // 开始事务
        await query('START TRANSACTION');

        try {
            for (const gradeData of grades) {
                const {
                    student_id,
                    attendance_score,
                    performance_score,
                    midterm_score,
                    final_score,
                    remarks
                } = gradeData;

                // 验证学生是否选了这门课
                const selection = await query(
                    'SELECT id FROM course_selections WHERE course_id = ? AND user_id = ? AND status = "selected"',
                    [courseId, student_id]
                );

                if (selection.length === 0) {
                    continue; // 跳过未选课的学生
                }

                // 计算总成绩和等级
                const attendanceWeight = 0.2;
                const performanceWeight = 0.3;
                const midtermWeight = 0.2;
                const finalWeight = 0.3;

                let total_score = 0;
                let scoreCount = 0;

                if (attendance_score !== undefined && attendance_score !== null) {
                    total_score += attendance_score * attendanceWeight;
                    scoreCount++;
                }
                if (performance_score !== undefined && performance_score !== null) {
                    total_score += performance_score * performanceWeight;
                    scoreCount++;
                }
                if (midterm_score !== undefined && midterm_score !== null) {
                    total_score += midterm_score * midtermWeight;
                    scoreCount++;
                }
                if (final_score !== undefined && final_score !== null) {
                    total_score += final_score * finalWeight;
                    scoreCount++;
                }

                if (scoreCount === 4) {
                    total_score = Math.round(total_score * 100) / 100;
                } else {
                    total_score = null;
                }

                let grade_level = null;
                if (total_score !== null) {
                    if (total_score >= 90) grade_level = 'A';
                    else if (total_score >= 80) grade_level = 'B';
                    else if (total_score >= 70) grade_level = 'C';
                    else if (total_score >= 60) grade_level = 'D';
                    else grade_level = 'F';
                }

                // 检查成绩记录是否已存在
                const existingGrade = await query(
                    'SELECT id FROM student_grades WHERE course_id = ? AND student_id = ? AND semester = ? AND academic_year = ?',
                    [courseId, student_id, semester, academic_year]
                );

                if (existingGrade.length > 0) {
                    // 更新现有成绩
                    await query(`
                        UPDATE student_grades 
                        SET attendance_score = ?, performance_score = ?, midterm_score = ?, 
                            final_score = ?, total_score = ?, grade_level = ?, remarks = ?,
                            updated_at = NOW()
                        WHERE id = ?
                    `, [
                        attendance_score, performance_score, midterm_score, final_score,
                        total_score, grade_level, remarks, existingGrade[0].id
                    ]);
                } else {
                    // 插入新成绩记录
                    await query(`
                        INSERT INTO student_grades (
                            course_id, student_id, attendance_score, performance_score,
                            midterm_score, final_score, total_score, grade_level,
                            remarks, semester, academic_year
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        courseId, student_id, attendance_score, performance_score,
                        midterm_score, final_score, total_score, grade_level,
                        remarks, semester, academic_year
                    ]);
                }
            }

            await query('COMMIT');

            res.json({
                success: true,
                message: '批量录入成绩成功'
            });

        } catch (error) {
            await query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('批量录入成绩错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 提交成绩到教务系统
const submitGrades = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.courseId;
        const { semester, academic_year } = req.body;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id, name FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限操作'
            });
        }

        // 检查是否所有学生都有完整成绩
        const incompleteGrades = await query(`
            SELECT COUNT(*) as count
            FROM course_selections cs
            LEFT JOIN student_grades sg ON sg.course_id = cs.course_id AND sg.student_id = cs.user_id 
                AND sg.semester = ? AND sg.academic_year = ?
            WHERE cs.course_id = ? AND cs.status = 'selected' 
            AND (sg.total_score IS NULL OR sg.grade_level IS NULL)
        `, [semester, academic_year, courseId]);

        if (incompleteGrades[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: `还有 ${incompleteGrades[0].count} 名学生的成绩不完整，无法提交`
            });
        }

        // 更新成绩提交状态
        await query(`
            UPDATE student_grades 
            SET is_submitted = TRUE, submit_time = NOW()
            WHERE course_id = ? AND semester = ? AND academic_year = ? AND is_submitted = FALSE
        `, [courseId, semester, academic_year]);

        // 获取提交的成绩统计
        const stats = await query(`
            SELECT 
                COUNT(*) as total_students,
                AVG(total_score) as average_score,
                COUNT(CASE WHEN grade_level = 'A' THEN 1 END) as grade_a_count,
                COUNT(CASE WHEN grade_level = 'B' THEN 1 END) as grade_b_count,
                COUNT(CASE WHEN grade_level = 'C' THEN 1 END) as grade_c_count,
                COUNT(CASE WHEN grade_level = 'D' THEN 1 END) as grade_d_count,
                COUNT(CASE WHEN grade_level = 'F' THEN 1 END) as grade_f_count
            FROM student_grades 
            WHERE course_id = ? AND semester = ? AND academic_year = ? AND is_submitted = TRUE
        `, [courseId, semester, academic_year]);

        res.json({
            success: true,
            message: '成绩提交成功',
            data: {
                course: course[0],
                semester,
                academic_year,
                statistics: stats[0]
            }
        });

    } catch (error) {
        console.error('提交成绩错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取成绩统计信息
const getGradeStatistics = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const courseId = req.params.courseId;
        const { semester, academic_year } = req.query;

        // 验证课程是否属于当前教师
        const course = await query(
            'SELECT id, name FROM courses WHERE id = ? AND teacher_id = ?',
            [courseId, teacherId]
        );

        if (course.length === 0) {
            return res.status(404).json({
                success: false,
                message: '课程不存在或无权限查看'
            });
        }

        // 首先检查是否有选课学生
        const enrolledStudents = await query(
            'SELECT COUNT(*) as count FROM course_selections WHERE course_id = ? AND status = "selected"',
            [courseId]
        );

        if (enrolledStudents[0].count === 0) {
            // 如果没有学生选课，返回空的统计数据
            return res.json({
                success: true,
                data: {
                    course: course[0],
                    semester,
                    academic_year,
                    total_students: 0,
                    average_score: 0,
                    pass_rate: 0,
                    excellent_rate: 0,
                    grade_distribution: [
                        { grade_level: 'A', count: 0 },
                        { grade_level: 'B', count: 0 },
                        { grade_level: 'C', count: 0 },
                        { grade_level: 'D', count: 0 },
                        { grade_level: 'F', count: 0 }
                    ],
                    statistics: {
                        total_students: 0,
                        graded_students: 0,
                        average_score: null,
                        highest_score: null,
                        lowest_score: null,
                        grade_a_count: 0,
                        grade_b_count: 0,
                        grade_c_count: 0,
                        grade_d_count: 0,
                        grade_f_count: 0,
                        submitted_count: 0
                    },
                    distribution: {
                        score_90_100: 0,
                        score_80_89: 0,
                        score_70_79: 0,
                        score_60_69: 0,
                        score_below_60: 0
                    }
                }
            });
        }

        // 构建查询条件
        let whereConditions = ['sg.course_id = ?'];
        let queryParams = [courseId];
        
        if (semester && academic_year) {
            whereConditions.push('sg.semester = ?', 'sg.academic_year = ?');
            queryParams.push(semester, academic_year);
        }
        
        const whereClause = whereConditions.join(' AND ');

        // 获取总学生数（选课的学生数）
        const totalStudentsResult = await query(`
            SELECT COUNT(DISTINCT cs.user_id) as total_students
            FROM course_selections cs
            WHERE cs.course_id = ? AND cs.status = "selected"
        `, [courseId]);

        // 获取成绩统计
        const stats = await query(`
            SELECT 
                COUNT(DISTINCT sg.student_id) as graded_students,
                AVG(sg.total_score) as average_score,
                MAX(sg.total_score) as highest_score,
                MIN(sg.total_score) as lowest_score,
                COUNT(CASE WHEN sg.grade_level = 'A' THEN 1 END) as grade_a_count,
                COUNT(CASE WHEN sg.grade_level = 'B' THEN 1 END) as grade_b_count,
                COUNT(CASE WHEN sg.grade_level = 'C' THEN 1 END) as grade_c_count,
                COUNT(CASE WHEN sg.grade_level = 'D' THEN 1 END) as grade_d_count,
                COUNT(CASE WHEN sg.grade_level = 'F' THEN 1 END) as grade_f_count,
                COUNT(CASE WHEN sg.is_submitted = TRUE THEN 1 END) as submitted_count
            FROM student_grades sg
            WHERE ${whereClause}
        `, queryParams);

        // 获取分数段分布
        const distribution = await query(`
            SELECT 
                COUNT(CASE WHEN sg.total_score >= 90 THEN 1 END) as score_90_100,
                COUNT(CASE WHEN sg.total_score >= 80 AND sg.total_score < 90 THEN 1 END) as score_80_89,
                COUNT(CASE WHEN sg.total_score >= 70 AND sg.total_score < 80 THEN 1 END) as score_70_79,
                COUNT(CASE WHEN sg.total_score >= 60 AND sg.total_score < 70 THEN 1 END) as score_60_69,
                COUNT(CASE WHEN sg.total_score < 60 THEN 1 END) as score_below_60
            FROM student_grades sg
            WHERE ${whereClause} AND sg.total_score IS NOT NULL
        `, queryParams);

        // 生成等级分布数据
        const gradeDistribution = [
            { grade_level: 'A', count: stats[0].grade_a_count || 0 },
            { grade_level: 'B', count: stats[0].grade_b_count || 0 },
            { grade_level: 'C', count: stats[0].grade_c_count || 0 },
            { grade_level: 'D', count: stats[0].grade_d_count || 0 },
            { grade_level: 'F', count: stats[0].grade_f_count || 0 }
        ];

        // 计算及格率和优秀率
        const gradedStudents = stats[0].graded_students || 0;
        const passCount = (stats[0].grade_a_count || 0) + (stats[0].grade_b_count || 0) + 
                          (stats[0].grade_c_count || 0) + (stats[0].grade_d_count || 0);
        const excellentCount = (stats[0].grade_a_count || 0) + (stats[0].grade_b_count || 0);
        
        const passRate = gradedStudents > 0 ? passCount / gradedStudents : 0;
        const excellentRate = gradedStudents > 0 ? excellentCount / gradedStudents : 0;

        res.json({
            success: true,
            data: {
                course: course[0],
                semester: semester || null,
                academic_year: academic_year || null,
                total_students: totalStudentsResult[0].total_students || 0,
                average_score: parseFloat(stats[0].average_score) || 0,
                pass_rate: passRate,
                excellent_rate: excellentRate,
                grade_distribution: gradeDistribution,
                statistics: {
                    ...stats[0],
                    total_students: totalStudentsResult[0].total_students || 0
                },
                distribution: distribution[0] || {
                    score_90_100: 0,
                    score_80_89: 0,
                    score_70_79: 0,
                    score_60_69: 0,
                    score_below_60: 0
                }
            }
        });

    } catch (error) {
        console.error('获取成绩统计错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误: ' + error.message
        });
    }
};

module.exports = {
    getCourseGrades,
    updateStudentGrade,
    batchUpdateGrades,
    submitGrades,
    getGradeStatistics
};
